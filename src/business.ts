import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex, zeroHash } from "viem";
import {createReceiptRequest,listReceiptRequests,decideReceiptRequests} from './receipt-requests.js';
import {document,productReference} from './business-data.js';
export {productReference} from './business-data.js';
import { config } from "./config.js";
import { db } from "./db.js";
import { readTraceForge } from "./chain.js";
import { hashPassword, verifyPassword } from "./operator-credentials.js";
import { BusinessProblem, businessWrite } from "./business-write.js";
import { issueProductShortLink } from "./public-short-links.js";
import { savePublicPresentation } from "./public-presentation.js";
import type { OperatorPrincipal } from "./operator-data.js";
import { readProductFields } from "./product-metadata.js";
import type { ProductField } from "./product-metadata.js";
import { productRegistration, productQuantity, removalInput, removalReasons } from "./product-input.js";
import { reserveBusinessCode } from "./business-codes.js";
import { quantitySummary, productRoutes } from "./product-quantity.js";
import {policy} from './transaction-policy.js';

const id = () => "0x" + randomBytes(32).toString("hex");
const hash = (value: string) => keccak256(stringToHex(value));
const event = (value: string) => hash(value);
async function semantics() {
  for (const [kind,value,label] of [["entity_type","PRODUCT","Product"],["state","PRODUCED","Produced"],
    ["event_type","PRODUCT_RECEIVED","Product received"],...["Sold","Lost","Damaged","Disposed"].map(reason=>
      ["event_type","PRODUCT_CLOSED_"+reason.toUpperCase(),reason+" · tracking closed"])]) {
    await db.query(`INSERT IGNORE INTO semantic_registry
      (chain_id,contract_address,semantic_kind,semantic_hash,semantic_value,display_label,source_ref) VALUES (?,?,?,?,?,?,?)`,
      [config.traceforge.chainId,config.traceforge.contractAddress,kind,event(value),value,label,"business-dashboard"]);
  }
}
const directory = () => {
  const configured = config.traceforge.businessWalletDirectory;
  if (!configured) throw new BusinessProblem("signup_unavailable", 503);
  return configured.startsWith("~/") ? resolve(homedir(), configured.slice(2)) : resolve(configured);
};

export interface SignupInput { email: string; password: string; name: string; businessName: string; businessType: string; publicProfile: boolean; businessCode?:string }
export async function signupBusiness(input: SignupInput) {
  if (!config.traceforge.broadcastEnabled) throw new BusinessProblem("signup_unavailable", 503);
  const email = input.email.trim().toLowerCase();
  const conn = await db.getConnection();
  let account: RowDataPacket;
  let businessCode:string;
  let newKey:string|undefined,newKeyPath:string|undefined,createdKeyFile:string|undefined;
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<RowDataPacket[]>(`SELECT a.*,b.production_role_id,b.business_name,b.business_type,b.public_profile
      FROM operator_accounts a LEFT JOIN business_wallets b ON b.organization_id=a.organization_id WHERE a.email=? FOR UPDATE`, [email]);
    if (existing[0]) {
      account = existing[0];
      if (account.active || !account.production_role_id || !await verifyPassword(input.password, account.password_digest))
        throw new BusinessProblem("account_unavailable", 400);
    } else {
      const path = directory();
      await mkdir(path, { recursive: true, mode: 0o700 });
      if ((await stat(path)).mode & 0o077) throw new BusinessProblem("signup_unavailable", 503);
      const key = generatePrivateKey(), wallet = privateKeyToAccount(key), organizationId = id(), tenantId = id(), roleId = id();
      // Never return or log this key; the browser has only its opaque session cookie.
      newKey=key;newKeyPath=resolve(path,organizationId+".key");
      const accountId = randomUUID(), passwordDigest = await hashPassword(input.password);
      await conn.query(`INSERT INTO business_wallets
        (organization_id,wallet_address,tenant_id,production_role_id,business_name,business_type,public_profile) VALUES (?,?,?,?,?,?,?)`,
        [organizationId,wallet.address.toLowerCase(),tenantId,roleId,input.businessName.trim(),input.businessType.trim(),input.publicProfile]);
      await conn.query(`INSERT INTO operator_accounts
        (account_id,email,display_name,tenant_id,organization_id,password_digest,active) VALUES (?,?,?,?,?,?,FALSE)`,
        [accountId,email,input.name.trim(),tenantId,organizationId,passwordDigest]);
      account = { account_id:accountId,tenant_id:tenantId,organization_id:organizationId,production_role_id:roleId,
        business_name:input.businessName.trim(),business_type:input.businessType.trim(),public_profile:input.publicProfile } as RowDataPacket;
    }
    try{businessCode=await reserveBusinessCode(conn,account.organization_id,input.businessCode);}
    catch(error){if(error instanceof Error&&/business code/i.test(error.message))throw new BusinessProblem("invalid_request",400);throw error;}
    if(newKey&&newKeyPath){await writeFile(newKeyPath,newKey+"\n",{flag:"wx",mode:0o600});createdKeyFile=newKeyPath;}
    await conn.commit();
  } catch (error) { await conn.rollback();if(createdKeyFile)await rm(createdKeyFile,{force:true});throw error; } finally { conn.release(); }
  const metadata = await document("organization", { name:account.business_name,organizationType:account.business_type });
  const workspaceMetadata = await document("tenant", { name:account.business_name });
  const base = { accountId:account.account_id,organizationId:account.organization_id,tenantId:account.tenant_id,entityId:zeroHash };
  try {
  const registered = await businessWrite({ ...base,operation:"registerBusiness",args:[account.organization_id,metadata],
    idempotencyKey:"signup-register",expectedEvent:"OrganizationRegistered" });
  if (registered.status !== "CONFIRMED") return { created:false,pending:true,businessCode };
  const workspace = await businessWrite({ ...base,operation:"createBusinessWorkspace",args:[account.tenant_id,workspaceMetadata,account.production_role_id],
    idempotencyKey:"signup-workspace",expectedEvent:"TenantCreated" });
  if (workspace.status !== "CONFIRMED") return { created:false,pending:true,businessCode };
  await db.query("UPDATE operator_accounts SET active=TRUE WHERE account_id=?", [account.account_id]);
  return { created:true,pending:false,businessCode };
  } catch(error) {
    if(policy.public && error instanceof BusinessProblem && error.code==='insufficient_gas_balance') {
      const [wallets]=await db.query<RowDataPacket[]>('SELECT wallet_address FROM business_wallets WHERE organization_id=?',[account.organization_id]);
      return {created:false,pending:true,businessCode,funding:{walletAddress:wallets[0].wallet_address,symbol:policy.symbol}};
    }
    throw error;
  }
}


export async function syncPublicDetails(reference: RowDataPacket) {
  if (!reference.public_details) return;
  if (reference.publication_initialized) {
    const [published] = await db.query<RowDataPacket[]>("SELECT tenant_id FROM public_entity_publications WHERE tenant_id=? AND entity_id=?", [reference.tenant_id,reference.entity_id]);
    if (!published.length) return; // An explicit unpublish must never be reversed by a read or receive.
  }
  const [products] = await db.query<RowDataPacket[]>(`SELECT e.metadata_hash,d.document_json
    FROM entities e JOIN offchain_documents d ON d.content_hash=e.metadata_hash
    WHERE e.tenant_id=? AND e.entity_id=?`, [reference.tenant_id,reference.entity_id]);
  if (!products[0]) return; // The indexer may not have projected this receipt yet.
  const [rows] = await db.query<RowDataPacket[]>(`SELECT b.organization_id,b.business_name,b.business_type,o.metadata_hash
    FROM business_wallets b JOIN organizations o ON o.organization_id=b.organization_id
    WHERE b.public_profile=TRUE AND (b.organization_id=? OR b.organization_id IN
      (SELECT from_organization_id FROM custody_claims WHERE tenant_id=? AND entity_id=?) OR b.organization_id IN
      (SELECT to_organization_id FROM custody_claims WHERE tenant_id=? AND entity_id=?) OR b.organization_id IN
      (SELECT organization_id FROM batch_routes WHERE chain_id=? AND contract_address=? AND tenant_id=? AND entity_id=?)) ORDER BY b.organization_id LIMIT 32`,
    [reference.creator_organization_id,reference.tenant_id,reference.entity_id,reference.tenant_id,reference.entity_id,
      config.traceforge.chainId,config.traceforge.contractAddress.toLowerCase(),reference.tenant_id,reference.entity_id]);
  const doc = typeof products[0].document_json === "string" ? JSON.parse(products[0].document_json) : products[0].document_json;
  await db.query("INSERT IGNORE INTO public_entity_publications (tenant_id,entity_id) VALUES (?,?)", [reference.tenant_id,reference.entity_id]);
  await db.query("INSERT IGNORE INTO public_entity_tracking_ids (tracking_id,tenant_id,entity_id) VALUES (UNHEX(SUBSTRING(?,3)),?,?)",
    [reference.tracking_id,reference.tenant_id,reference.entity_id]);
  await savePublicPresentation(db,reference.tenant_id,reference.entity_id,{ metadataHash:products[0].metadata_hash,
    productInfo:{name:doc.name,description:doc.description?.trim()||null,fields:readProductFields(doc.fields)},
    organizations:rows.map(row=>({id:row.organization_id,metadataHash:row.metadata_hash,name:row.business_name,type:row.business_type})) });
  // Codes already exist for confirmed registrations, including private ones.
  await db.query("UPDATE business_product_records SET publication_initialized=TRUE WHERE tracking_id=?",[reference.tracking_id]);
}

export async function receiveLookup(principal: OperatorPrincipal, tracking: string) {
  const ref = await productReference(tracking);
  const entity=await readTraceForge("getEntity",[ref.tenant_id,ref.entity_id]);
  const isBatch=ref.initial_quantity!=null&&BigInt(ref.initial_quantity)>1n;
  const version=isBatch?null:await readTraceForge("getCustodyVersion",[ref.tenant_id,ref.entity_id]);
  // A scan can reveal the public label, state and holder. Private product documents remain private.
  await syncPublicDetails(ref);
  const [names] = await db.query<RowDataPacket[]>(`SELECT p.product_info,o.business_name,o.public_profile
    FROM business_product_records r LEFT JOIN public_entity_presentations p ON p.tenant_id=r.tenant_id AND p.entity_id=r.entity_id
      AND p.metadata_hash=? AND EXISTS (SELECT 1 FROM public_entity_publications pub WHERE pub.tenant_id=r.tenant_id AND pub.entity_id=r.entity_id)
    LEFT JOIN business_wallets o ON o.organization_id=? WHERE r.tracking_id=?`, [entity.metadataHash,entity.currentCustodian,ref.tracking_id]);
  const info = names[0]?.product_info;
  const product = typeof info === "string" ? JSON.parse(info) : info;
  const summary=await quantitySummary(db,[config.traceforge.chainId,config.traceforge.contractAddress.toLowerCase()],ref.tenant_id,ref.entity_id,principal.organizationId,Boolean(product));
  if(isBatch&&!summary)throw new BusinessProblem("business_not_ready",503);
  const routes=isBatch?await productRoutes(db,[config.traceforge.chainId,config.traceforge.contractAddress.toLowerCase()],ref.tenant_id,ref.entity_id,"0",50):null;
  return { trackingId:ref.tracking_id,name:product?.name??null,holder:isBatch?null:{id:entity.currentCustodian,
    name:names[0]?.public_profile?names[0].business_name:null},closed:Boolean(entity.closed),version:version===null?null:String(version),
    canReceive:!entity.closed && (isBatch?BigInt(summary!.availableQuantity)>BigInt(summary!.ownAvailableQuantity??"0"):entity.currentCustodian.toLowerCase()!==principal.organizationId),
    ...(summary?{quantity:summary}:{}),...(routes?{routes:routes.routes,page:routes.page}:{}) };
}

export interface CreateInput { name:string; id:string; quantity?:number; description?:string; fields?:ProductField[]; publish:boolean; idempotencyKey:string }
export async function createBusinessProduct(principal: OperatorPrincipal, input: CreateInput) {
  let registration:ReturnType<typeof productRegistration>;
  try { registration=productRegistration(input); }
  catch { throw new BusinessProblem("invalid_request", 400); }
  await semantics();
  const [wallets] = await db.query<RowDataPacket[]>("SELECT tenant_id,production_role_id FROM business_wallets WHERE organization_id=?", [principal.organizationId]);
  if (!wallets[0]) throw new BusinessProblem("business_not_ready", 503);
  const tenantId = wallets[0].tenant_id, metadataHash = await document("entity",registration);
  // A deterministic identity for this actor/request makes retries create the same product.
  const trackingId = hash(`CREATE_PRODUCT_V2:${config.traceforge.chainId}:${config.traceforge.contractAddress.toLowerCase()}:${principal.organizationId}:${input.idempotencyKey}`), entityId = trackingId;
  await db.query(`INSERT IGNORE INTO business_product_records (tracking_id,tenant_id,entity_id,creator_organization_id,public_details,
    chain_id,contract_address,registration_metadata_hash,external_id,initial_quantity) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [trackingId,tenantId,entityId,principal.organizationId,input.publish,config.traceforge.chainId,config.traceforge.contractAddress.toLowerCase(),metadataHash,registration.id,registration.quantity]);
  const [refs] = await db.query<RowDataPacket[]>("SELECT * FROM business_product_records WHERE tracking_id=?", [trackingId]);
  if (Boolean(refs[0].public_details)!==input.publish||refs[0].registration_metadata_hash!==metadataHash) throw new BusinessProblem("request_conflict");
  const result = await businessWrite({ accountId:principal.accountId,organizationId:principal.organizationId,tenantId,entityId,
    operation:"createProduct",args:[tenantId,wallets[0].production_role_id,entityId,metadataHash,BigInt(registration.quantity)],
    idempotencyKey:input.idempotencyKey,expectedEvent:"ProductRegistered" });
  let shortCode:string|null=null;
  if(result.status==="CONFIRMED"){
    await db.query("UPDATE business_product_records SET confirmed=TRUE WHERE tracking_id=?",[trackingId]);
    await db.query("INSERT IGNORE INTO public_entity_tracking_ids(tracking_id,tenant_id,entity_id) VALUES(UNHEX(SUBSTRING(?,3)),?,?)",[trackingId,tenantId,entityId]);
    shortCode=await issueProductShortLink(db,trackingId);
    await syncPublicDetails(refs[0]);
  }
  return { ...result,trackingId,shortCode };
}
export interface IntegrationEvidence {operationId:string;reference:string|null;occurredAt:string|null}
export interface ReceiveInput {version:string;confirmed:boolean;idempotencyKey:string;sourceRouteId?:string;quantity?:number;integration?:IntegrationEvidence}
export async function receiveBusinessProduct(principal: OperatorPrincipal, tracking: string,
  input:ReceiveInput) {
  return createReceiptRequest(principal,tracking,input);
}
export interface RemoveInput {reason?:typeof removalReasons[number];reasonText?:string;confirmed:boolean;idempotencyKey:string;routeId?:string;quantity?:number;version?:string;integration?:IntegrationEvidence}
export async function closeBusinessProduct(principal:OperatorPrincipal,tracking:string,
  input:RemoveInput) {
  if (!input.confirmed) throw new BusinessProblem("close_confirmation_required",400);
  const ref=await productReference(tracking);
  const registered=ref.initial_quantity!=null,isBatch=registered&&BigInt(ref.initial_quantity)>1n;
  let normalized:ReturnType<typeof removalInput>,quantity:number;
  try{normalized=registered?removalInput(input):{reason:input.reason??"Sold",reasonText:input.reasonText??""};quantity=productQuantity(input.quantity);
    if(registered&&!input.version||isBatch&&(!input.routeId||input.quantity===undefined)||!isBatch&&(quantity!==1||input.routeId&&input.routeId!==zeroHash))throw new Error("Invalid removal.");}
  catch{throw new BusinessProblem("invalid_request",400);}
  const routeId=isBatch?input.routeId!.toLowerCase():zeroHash;
  const evidence=await document("evidence",{
    action:"REMOVE",...normalized,organizationId:principal.organizationId,trackingId:ref.tracking_id,quantity,
    ...(registered?{routeId,version:input.version}:{}),confirmed:true,
    ...(input.integration?{integration:input.integration}:{}) });
  const result=await businessWrite({accountId:principal.accountId,organizationId:principal.organizationId,tenantId:ref.tenant_id,entityId:ref.entity_id,
    operation:registered?"removeProduct":"closeEntity",args:registered?[ref.tenant_id,ref.entity_id,routeId,BigInt(quantity),BigInt(input.version!),
      removalReasons.indexOf(normalized.reason),normalized.reasonText,evidence]:[ref.tenant_id,zeroHash,ref.entity_id,event("PRODUCT_CLOSED_"+normalized.reason.toUpperCase()),evidence],
    idempotencyKey:input.idempotencyKey,expectedEvent:registered?"QuantityRemoved":"EntityClosed"});
  return {...result,trackingId:ref.tracking_id,removedQuantity:String(quantity),...normalized};
}
export const businessActions={signup:signupBusiness,create:createBusinessProduct,lookup:receiveLookup,receive:receiveBusinessProduct,close:closeBusinessProduct,requests:listReceiptRequests,decisions:decideReceiptRequests};
