import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex, zeroHash } from "viem";
import { config } from "./config.js";
import { db } from "./db.js";
import { readTraceForge } from "./chain.js";
import { hashPassword, verifyPassword } from "./operator-credentials.js";
import { BusinessProblem, businessWrite } from "./business-write.js";
import { issuePublicShortLink, normalizeShortCode } from "./public-short-links.js";
import { savePublicPresentation } from "./public-presentation.js";
import type { OperatorPrincipal } from "./operator-data.js";
import { normalizeProductFields, readProductFields } from "./product-metadata.js";
import type { ProductField } from "./product-metadata.js";

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
async function document(kind: string, value: unknown) {
  const raw = JSON.stringify(value), contentHash = hash(raw);
  await db.query(`INSERT IGNORE INTO offchain_documents
    (content_hash,document_kind,source_ref,byte_length,document_json,raw_text) VALUES (?,?,?,?,?,?)`,
    [contentHash,kind,"business-dashboard",Buffer.byteLength(raw),raw,raw]);
  return contentHash;
}

export interface SignupInput { email: string; password: string; name: string; businessName: string; businessType: string; publicProfile: boolean }
export async function signupBusiness(input: SignupInput) {
  if (!config.traceforge.broadcastEnabled) throw new BusinessProblem("signup_unavailable", 503);
  const email = input.email.trim().toLowerCase();
  const conn = await db.getConnection();
  let account: RowDataPacket;
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
      await writeFile(resolve(path, organizationId + ".key"), key + "\n", { flag: "wx", mode: 0o600 });
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
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  const metadata = await document("organization", { name:account.business_name,organizationType:account.business_type });
  const workspaceMetadata = await document("tenant", { name:account.business_name });
  const base = { accountId:account.account_id,organizationId:account.organization_id,tenantId:account.tenant_id,entityId:zeroHash };
  const registered = await businessWrite({ ...base,operation:"registerBusiness",args:[account.organization_id,metadata],
    idempotencyKey:"signup-register",expectedEvent:"OrganizationRegistered" });
  if (registered.status !== "CONFIRMED") return { created:false,pending:true };
  const workspace = await businessWrite({ ...base,operation:"createBusinessWorkspace",args:[account.tenant_id,workspaceMetadata,account.production_role_id],
    idempotencyKey:"signup-workspace",expectedEvent:"TenantCreated" });
  if (workspace.status !== "CONFIRMED") return { created:false,pending:true };
  await db.query("UPDATE operator_accounts SET active=TRUE WHERE account_id=?", [account.account_id]);
  return { created:true,pending:false };
}

async function productReference(tracking: string) {
  let trackingId = tracking.toLowerCase();
  if (normalizeShortCode(trackingId)) {
    const [aliases] = await db.query<RowDataPacket[]>(`SELECT CONCAT('0x',LOWER(HEX(tracking_id))) AS tracking_id
      FROM public_entity_short_links WHERE short_code=?`, [trackingId]);
    if (!aliases[0]) throw new BusinessProblem("product_not_found", 404);
    trackingId = aliases[0].tracking_id;
  }
  if (!/^0x[0-9a-f]{64}$/.test(trackingId)) throw new BusinessProblem("invalid_request", 400);
  const [rows] = await db.query<RowDataPacket[]>(`SELECT tracking_id,tenant_id,entity_id,creator_organization_id,public_details,publication_initialized
    FROM business_product_records WHERE tracking_id=?`, [trackingId]);
  if (!rows[0]) throw new BusinessProblem("product_not_found", 404);
  return rows[0];
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
      (SELECT to_organization_id FROM custody_claims WHERE tenant_id=? AND entity_id=?)) LIMIT 32`,
    [reference.creator_organization_id,reference.tenant_id,reference.entity_id,reference.tenant_id,reference.entity_id]);
  const doc = typeof products[0].document_json === "string" ? JSON.parse(products[0].document_json) : products[0].document_json;
  await db.query("INSERT IGNORE INTO public_entity_publications (tenant_id,entity_id) VALUES (?,?)", [reference.tenant_id,reference.entity_id]);
  await db.query("INSERT IGNORE INTO public_entity_tracking_ids (tracking_id,tenant_id,entity_id) VALUES (UNHEX(SUBSTRING(?,3)),?,?)",
    [reference.tracking_id,reference.tenant_id,reference.entity_id]);
  await savePublicPresentation(db,reference.tenant_id,reference.entity_id,{ metadataHash:products[0].metadata_hash,
    productInfo:{name:doc.name,description:doc.description?.trim()||null,fields:readProductFields(doc.fields)},
    organizations:rows.map(row=>({id:row.organization_id,metadataHash:row.metadata_hash,name:row.business_name,type:row.business_type})) });
  await issuePublicShortLink(db,reference.tracking_id);
  await db.query("UPDATE business_product_records SET publication_initialized=TRUE WHERE tracking_id=?",[reference.tracking_id]);
}

export async function receiveLookup(principal: OperatorPrincipal, tracking: string) {
  const ref = await productReference(tracking);
  const [entity, version] = await Promise.all([readTraceForge("getEntity",[ref.tenant_id,ref.entity_id]),
    readTraceForge("getCustodyVersion",[ref.tenant_id,ref.entity_id])]);
  // A scan can reveal the public label, state and holder. Private product documents remain private.
  await syncPublicDetails(ref);
  const [names] = await db.query<RowDataPacket[]>(`SELECT p.product_info,o.business_name,o.public_profile
    FROM business_product_records r LEFT JOIN public_entity_presentations p ON p.tenant_id=r.tenant_id AND p.entity_id=r.entity_id
      AND p.metadata_hash=? AND EXISTS (SELECT 1 FROM public_entity_publications pub WHERE pub.tenant_id=r.tenant_id AND pub.entity_id=r.entity_id)
    LEFT JOIN business_wallets o ON o.organization_id=? WHERE r.tracking_id=?`, [entity.metadataHash,entity.currentCustodian,ref.tracking_id]);
  const info = names[0]?.product_info;
  const product = typeof info === "string" ? JSON.parse(info) : info;
  return { trackingId:ref.tracking_id,name:product?.name??null,holder:{id:entity.currentCustodian,
    name:names[0]?.public_profile?names[0].business_name:null},closed:Boolean(entity.closed),version:String(version),
    canReceive:!entity.closed && entity.currentCustodian.toLowerCase()!==principal.organizationId };
}

export interface CreateInput { name:string; description:string; fields?:ProductField[]; publish:boolean; idempotencyKey:string }
export async function createBusinessProduct(principal: OperatorPrincipal, input: CreateInput) {
  let fields: ProductField[];
  try { fields = normalizeProductFields(input.fields); }
  catch { throw new BusinessProblem("invalid_request", 400); }
  await semantics();
  const [wallets] = await db.query<RowDataPacket[]>("SELECT tenant_id,production_role_id FROM business_wallets WHERE organization_id=?", [principal.organizationId]);
  if (!wallets[0]) throw new BusinessProblem("business_not_ready", 503);
  const tenantId = wallets[0].tenant_id, metadataHash = await document("entity",{
    name:input.name.trim(),description:input.description.trim(),...(fields.length?{fields}:{}) });
  // A deterministic identity for this actor/request makes retries create the same product.
  const trackingId = hash(principal.organizationId + ":" + input.idempotencyKey), entityId = trackingId;
  await db.query(`INSERT IGNORE INTO business_product_records (tracking_id,tenant_id,entity_id,creator_organization_id,public_details)
    VALUES (?,?,?,?,?)`, [trackingId,tenantId,entityId,principal.organizationId,input.publish]);
  const [refs] = await db.query<RowDataPacket[]>("SELECT * FROM business_product_records WHERE tracking_id=?", [trackingId]);
  if (Boolean(refs[0].public_details)!==input.publish) throw new BusinessProblem("request_conflict");
  const result = await businessWrite({ accountId:principal.accountId,organizationId:principal.organizationId,tenantId,entityId,
    operation:"createEntity",args:[tenantId,wallets[0].production_role_id,entityId,event("PRODUCT"),metadataHash,event("PRODUCED")],
    idempotencyKey:input.idempotencyKey,expectedEvent:"EntityCreated" });
  await syncPublicDetails(refs[0]);
  return { ...result,trackingId };
}
export async function receiveBusinessProduct(principal: OperatorPrincipal, tracking: string,
  input:{version:string;confirmed:boolean;idempotencyKey:string}) {
  if (!input.confirmed) throw new BusinessProblem("receipt_confirmation_required", 400);
  const ref=await productReference(tracking), evidence=await document("evidence",{
    action:"PHYSICAL_RECEIPT",organizationId:principal.organizationId,trackingId:ref.tracking_id,version:input.version,confirmed:true });
  const result=await businessWrite({accountId:principal.accountId,organizationId:principal.organizationId,tenantId:ref.tenant_id,entityId:ref.entity_id,
    operation:"claimCustody",args:[ref.tenant_id,ref.entity_id,BigInt(input.version),event("PRODUCT_RECEIVED"),evidence],
    idempotencyKey:input.idempotencyKey,expectedEvent:"CustodyClaimed"});
  await syncPublicDetails(ref);
  return {...result,trackingId:ref.tracking_id};
}
export async function closeBusinessProduct(principal:OperatorPrincipal,tracking:string,
  input:{reason:"Sold"|"Lost"|"Damaged"|"Disposed";confirmed:boolean;idempotencyKey:string}) {
  if (!input.confirmed) throw new BusinessProblem("close_confirmation_required",400);
  const ref=await productReference(tracking), evidence=await document("evidence",{
    action:"CLOSE",reason:input.reason,organizationId:principal.organizationId,trackingId:ref.tracking_id });
  const result=await businessWrite({accountId:principal.accountId,organizationId:principal.organizationId,tenantId:ref.tenant_id,entityId:ref.entity_id,
    operation:"closeEntity",args:[ref.tenant_id,zeroHash,ref.entity_id,event("PRODUCT_CLOSED_"+input.reason.toUpperCase()),evidence],
    idempotencyKey:input.idempotencyKey,expectedEvent:"EntityClosed"});
  return {...result,trackingId:ref.tracking_id};
}
export const businessActions={signup:signupBusiness,create:createBusinessProduct,lookup:receiveLookup,receive:receiveBusinessProduct,close:closeBusinessProduct};
