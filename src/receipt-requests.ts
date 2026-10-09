import {randomUUID} from 'node:crypto';
import {BaseError,ContractFunctionRevertedError,keccak256,stringToHex,zeroHash} from 'viem';
import type {RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {db} from './db.js';
import {config} from './config.js';
import {readTraceForge} from './chain.js';
import {businessWrite,BusinessProblem} from './business-write.js';
import {canonicalRequestHash} from './write-journal.js';
import {digest} from './operator-credentials.js';
import {productReference,document} from './business-data.js';
import type {ReceiveInput} from './business.js';
import type {OperatorPrincipal} from './operator-data.js';
import {productQuantity} from './product-input.js';
import {receiptDecisions,validateReceiptInput} from './receipt-input.js';

const scope=[config.traceforge.chainId,config.traceforge.contractAddress.toLowerCase()] as const;
const hash=(s:string)=>keccak256(stringToHex(s));
const columns=`r.*,UNIX_TIMESTAMP(r.expires_at) expires_epoch,UNIX_TIMESTAMP(r.created_at) created_epoch`;
const transient=new Set(['business_busy','chain_unavailable','receipt_unverified','writes_disabled','transaction_pending','finality_unavailable','insufficient_gas_balance','fee_limit_exceeded']);
const parse=<T>(v:unknown):T=>typeof v==='string'?JSON.parse(v):v as T;
const iso=(v:unknown)=>new Date(Number(v)*1000).toISOString();
function result(row:RowDataPacket) {
 const mined=row.result_json?parse<Record<string,unknown>>(row.result_json):{};
 return {...mined,operationId:typeof mined.operationId==='string'?mined.operationId:row.request_id,
  receiptRequestId:row.request_id,status:row.status,trackingId:row.tracking_id,
  transactionHash:row.transaction_hash??null,blockNumber:typeof mined.blockNumber==='string'?mined.blockNumber:null,
  quantity:String(row.quantity),...(row.received_route_id!==zeroHash?{receivedRouteId:row.received_route_id}:{})};
}
async function rowById(requestId:string) {
 const [rows]=await db.query<RowDataPacket[]>(`SELECT ${columns} FROM receipt_requests r WHERE request_id=? AND chain_id=? AND contract_address=?`,[requestId,...scope]);
 return rows[0];
}
async function liveStock(row:{tenant_id:string;entity_id:string;source_route_id:string}) {
 try {
  const entity=await readTraceForge('getEntity',[row.tenant_id,row.entity_id]);
  if(entity.closed)throw new BusinessProblem('operation_not_allowed');
  if(row.source_route_id!==zeroHash) {
   const route=await readTraceForge('getBatchRoute',[row.tenant_id,row.entity_id,row.source_route_id]);
   return {owner:route.organizationId.toLowerCase(),quantity:route.availableQuantity,version:route.version};
  }
  return {owner:entity.currentCustodian.toLowerCase(),quantity:1n,version:await readTraceForge('getCustodyVersion',[row.tenant_id,row.entity_id])};
 }catch(error){
  if(error instanceof BusinessProblem)throw error;
  const reverted=error instanceof BaseError&&error.walk(e=>e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError;
  throw new BusinessProblem(reverted?'operation_not_allowed':'chain_unavailable',reverted?409:503);
 }
}
export async function createReceiptRequest(principal:OperatorPrincipal,tracking:string,input:ReceiveInput) {
 try{validateReceiptInput(input as unknown as Record<string,unknown>);}catch{throw new BusinessProblem('invalid_request',400);}
 const ref=await productReference(tracking),batch=ref.initial_quantity!=null&&BigInt(ref.initial_quantity)>1n;
 const quantity=productQuantity(input.quantity),source=input.sourceRouteId?.toLowerCase()??zeroHash;
 if(batch&&(!input.sourceRouteId||input.quantity===undefined)||!batch&&(source!==zeroHash||quantity!==1))throw new BusinessProblem('invalid_request',400);
 const requestHash=canonicalRequestHash({trackingId:ref.tracking_id,...input});
 const requestKey=digest(input.idempotencyKey);
 const [previous]=await db.query<RowDataPacket[]>(`SELECT ${columns} FROM receipt_requests r WHERE chain_id=? AND contract_address=? AND requester_organization_id=? AND request_key=?`,[...scope,principal.organizationId,requestKey]);
 if(previous[0]) {
  if(previous[0].request_hash!==requestHash)throw new BusinessProblem('request_conflict');
  return result(previous[0]);
 }
 if(!config.traceforge.broadcastEnabled)throw new BusinessProblem('writes_disabled',503);
 const stock=await liveStock({tenant_id:ref.tenant_id,entity_id:ref.entity_id,source_route_id:source});
 if(stock.owner===principal.organizationId.toLowerCase())throw new BusinessProblem('operation_not_allowed');
 if(stock.version!==BigInt(input.version))throw new BusinessProblem('stock_changed');
 if(BigInt(quantity)>stock.quantity)throw new BusinessProblem('quantity_exceeds_available');
 const [wallets]=await db.query<RowDataPacket[]>('SELECT wallet_address FROM business_wallets WHERE organization_id=?',[principal.organizationId]);
 if(!wallets[0])throw new BusinessProblem('business_not_ready',503);
 const requestId=randomUUID(),chainRequestId=hash(`TRACEFORGE_RECEIPT_REQUEST_V1:${scope[0]}:${scope[1]}:${requestId}`);
 const received=batch?hash(`TRACEFORGE_APPROVED_ROUTE_V1:${chainRequestId}`):zeroHash;
 const conn=await db.getConnection(),lock='tf-receipt-create:'+digest(principal.organizationId).slice(0,40);
 let locked=false;
 try {
  const [locks]=await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?,5) acquired',[lock]);locked=Number(locks[0].acquired)===1;
  if(!locked)throw new BusinessProblem('business_busy',429);
  const [pending]=await conn.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM receipt_requests WHERE chain_id=? AND contract_address=? AND requester_organization_id=? AND status IN ('WAITING_APPROVAL','APPROVING')`,[...scope,principal.organizationId]);
  if(Number(pending[0].n)>=1000)throw new BusinessProblem('too_many_requests',429);
  await conn.query(`INSERT IGNORE INTO receipt_requests(request_id,chain_request_id,chain_id,contract_address,tracking_id,tenant_id,entity_id,
   source_organization_id,requester_organization_id,requester_account_id,requester_wallet,source_route_id,received_route_id,quantity,requested_version,
   request_key,request_hash,request_json,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 72 HOUR))`,
   [requestId,chainRequestId,...scope,ref.tracking_id,ref.tenant_id,ref.entity_id,stock.owner,principal.organizationId,principal.accountId,
    wallets[0].wallet_address.toLowerCase(),source,received,quantity,input.version,requestKey,requestHash,JSON.stringify(input)]);
  const [created]=await conn.query<RowDataPacket[]>(`SELECT ${columns} FROM receipt_requests r WHERE chain_id=? AND contract_address=? AND requester_organization_id=? AND request_key=?`,[...scope,principal.organizationId,requestKey]);
  if(created[0].request_hash!==requestHash)throw new BusinessProblem('request_conflict');
  return result(created[0]);
 }finally{if(locked)await conn.query('SELECT RELEASE_LOCK(?)',[lock]);conn.release();}
}
export async function expireReceiptRequests() {
 // Discover expired IDs without locks, then update only those unique keys.
 // Even an indexed range UPDATE can lock its first unexpired boundary row and
 // deadlock with an owner's primary-key approval lock. Recheck status/expiry
 // during the update so an intervening decision cannot be overwritten.
 const [expired]=await db.query<RowDataPacket[]>(`SELECT request_id FROM receipt_requests FORCE INDEX(receipt_expiry)
  WHERE chain_id=? AND contract_address=? AND status='WAITING_APPROVAL' AND expires_at<=CURRENT_TIMESTAMP(3)
  ORDER BY expires_at,sequence_id LIMIT 1000`,[...scope]);
 if(expired.length)await db.query(`UPDATE receipt_requests FORCE INDEX(request_id) SET status='EXPIRED',error_code='request_expired'
  WHERE request_id IN (?) AND chain_id=? AND contract_address=? AND status='WAITING_APPROVAL' AND expires_at<=CURRENT_TIMESTAMP(3)`,[expired.map(row=>row.request_id),...scope]);
}
export async function listReceiptRequests(principal:OperatorPrincipal,direction:'incoming'|'outgoing',after='0',limit=50) {
 await expireReceiptRequests();
 const column=direction==='incoming'?'source_organization_id':'requester_organization_id';
 const [rows]=await db.query<RowDataPacket[]>(`SELECT ${columns},sb.business_name source_name,sb.wallet_address source_wallet,
  rb.business_name requester_name,CASE WHEN r.source_organization_id=? OR r.status='CONFIRMED' OR
  EXISTS(SELECT 1 FROM public_entity_publications pub WHERE pub.tenant_id=r.tenant_id AND pub.entity_id=r.entity_id)
  THEN JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.name')) ELSE NULL END product_name
  FROM receipt_requests r LEFT JOIN business_wallets sb ON sb.organization_id=r.source_organization_id
  LEFT JOIN business_wallets rb ON rb.organization_id=r.requester_organization_id
  LEFT JOIN business_product_records p ON p.tracking_id=r.tracking_id
  LEFT JOIN offchain_documents d ON d.content_hash=p.registration_metadata_hash AND d.document_kind='entity'
  WHERE r.chain_id=? AND r.contract_address=? AND r.${column}=? AND (?=0 OR r.sequence_id<?) ORDER BY r.sequence_id DESC LIMIT ?`,[principal.organizationId,...scope,principal.organizationId,after,after,limit+1]);
 const items=rows.slice(0,limit);
 return {requests:items.map(row=>({id:row.request_id,trackingId:row.tracking_id,name:row.product_name??null,
  source:{id:row.source_organization_id,name:row.source_name??null,walletAddress:row.source_wallet??null},
  requester:{id:row.requester_organization_id,name:row.requester_name??null,walletAddress:row.requester_wallet},
  sourceRouteId:row.source_route_id===zeroHash?null:row.source_route_id,quantity:String(row.quantity),status:row.status,
  createdAt:iso(row.created_epoch),expiresAt:iso(row.expires_epoch),transactionHash:row.transaction_hash??null,errorCode:row.error_code??null})),
  page:{hasMore:rows.length>limit,next:rows.length>limit?String(items[items.length-1].sequence_id):null}};
}
export async function decideReceiptRequests(principal:OperatorPrincipal,value:unknown) {
 let input:ReturnType<typeof receiptDecisions>;
 try{input=receiptDecisions(value);}catch{throw new BusinessProblem('invalid_request',400);}
 await expireReceiptRequests();
 const results=[];
 for(const requestId of input.requestIds) {
  const conn=await db.getConnection(),lock='tf-receipt-decide:'+digest(principal.organizationId).slice(0,40);
  let locked=false;
  try {
   const [locks]=await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?,5) acquired',[lock]);locked=Number(locks[0].acquired)===1;
   if(!locked)throw new BusinessProblem('business_busy',429);
   await conn.beginTransaction();
   const [rows]=await conn.query<RowDataPacket[]>(`SELECT ${columns} FROM receipt_requests r WHERE request_id=? AND chain_id=? AND contract_address=? FOR UPDATE`,[requestId,...scope]);
   const row=rows[0],authorized=input.action==='cancel'?row?.requester_organization_id:row?.source_organization_id;
   if(!row||authorized!==principal.organizationId)throw new BusinessProblem('request_not_found',404);
   // Maintenance is bounded; enforce this row's deadline even if another
   // business's expired backlog has consumed the current sweep's limit.
   if(row.status==='WAITING_APPROVAL'&&Number(row.expires_epoch)*1000<=Date.now()){
    await conn.query("UPDATE receipt_requests SET status='EXPIRED',error_code='request_expired' WHERE request_id=?",[requestId]);
    await conn.commit();results.push({requestId,ok:false,result:null,error:{code:'request_expired'}});continue;
   }
   const target=input.action==='approve'?'APPROVING':input.action==='decline'?'DECLINED':'CANCELLED';
   if(row.status==='WAITING_APPROVAL') {
    if(input.action==='approve') {
     const stock=await liveStock(row as any);
     if(stock.owner!==principal.organizationId.toLowerCase()||row.source_route_id===zeroHash&&stock.version!==BigInt(row.requested_version))throw new BusinessProblem('stock_changed');
     const [reserved]=await conn.query<RowDataPacket[]>(`SELECT COALESCE(SUM(quantity),0) quantity FROM receipt_requests WHERE chain_id=? AND contract_address=? AND tenant_id=? AND entity_id=? AND source_route_id=? AND status='APPROVING'`,[...scope,row.tenant_id,row.entity_id,row.source_route_id]);
     if(BigInt(row.quantity)+BigInt(reserved[0].quantity)>stock.quantity)throw new BusinessProblem('quantity_exceeds_available');
    }
    await conn.query(`UPDATE receipt_requests SET status=?,approver_account_id=?,approval_key=?,error_code=NULL WHERE request_id=?`,
     [target,input.action==='approve'?principal.accountId:null,digest(input.idempotencyKey),requestId]);
   }else if(row.status!==target&&!(input.action==='approve'&&row.status==='CONFIRMED'))throw new BusinessProblem('request_not_pending');
   await conn.commit();
   results.push({requestId,ok:true,result:result((await rowById(requestId))!),error:null});
  }catch(error){
   await conn.rollback();
   results.push({requestId,ok:false,result:null,error:{code:error instanceof BusinessProblem?error.code:'request_unavailable'}});
  }finally{if(locked)await conn.query('SELECT RELEASE_LOCK(?)',[lock]);conn.release();}
 }
 return {results};
}

// Receipts use the same durable signer journal as every other business write.
// Approval queue leases survive worker crashes; a prepared payload is never changed.
export async function processReceiptApprovalsOnce(options:{shouldStop?:()=>boolean}={}) {
 await expireReceiptRequests();
 const [candidates]=await db.query<RowDataPacket[]>(`SELECT request_id FROM receipt_requests WHERE chain_id=? AND contract_address=? AND status='APPROVING'
  AND next_attempt_at<=CURRENT_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP(3)) ORDER BY sequence_id LIMIT 25`,[...scope]);
 let processed=0;
 for(const candidate of candidates) {
  if(options.shouldStop?.())break;
  const candidateRow=(await rowById(candidate.request_id))!;
  const conn=await db.getConnection(),lease=randomUUID(),lock='tf-receipt-work:'+digest(candidateRow.source_organization_id).slice(0,40);
  let locked=false,heartbeat:ReturnType<typeof setInterval>|undefined;
  try {
   const [locks]=await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) acquired',[lock]);locked=Number(locks[0].acquired)===1;if(!locked)continue;
   const [owned]=await conn.query<ResultSetHeader>(`UPDATE receipt_requests SET lease_token=?,lease_until=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 90 SECOND),attempts=attempts+1
    WHERE request_id=? AND status='APPROVING' AND (lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP(3))`,[lease,candidate.request_id]);
   if(owned.affectedRows!==1)continue;
   heartbeat=setInterval(()=>{void db.query('UPDATE receipt_requests SET lease_until=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 90 SECOND) WHERE request_id=? AND lease_token=?',[candidate.request_id,lease]).catch(()=>{});},20000);
   const row=(await rowById(candidate.request_id))!;
   try {
    let approval:Record<string,string>;
    if(row.prepared_json)approval=parse(row.prepared_json);
    else {
     const [pending]=await conn.query<RowDataPacket[]>("SELECT operation_id FROM chain_write_operations WHERE organization_id=? AND status IN ('PREPARED','BROADCAST') LIMIT 1",[row.source_organization_id]);
     if(pending.length)throw new BusinessProblem('business_busy',429);
     const [accounts]=await conn.query<RowDataPacket[]>('SELECT account_id,organization_id FROM operator_accounts WHERE active=TRUE AND account_id IN (?,?)',[row.approver_account_id,row.requester_account_id]);
     if(!accounts.some(a=>a.account_id===row.approver_account_id&&a.organization_id===row.source_organization_id)||!accounts.some(a=>a.account_id===row.requester_account_id&&a.organization_id===row.requester_organization_id))throw new BusinessProblem('account_unavailable');
     if(Number(row.expires_epoch)*1000<=Date.now())throw new BusinessProblem('request_expired');
     const stock=await liveStock(row as any);
     if(stock.owner!==row.source_organization_id||row.source_route_id===zeroHash&&stock.version!==BigInt(row.requested_version))throw new BusinessProblem('stock_changed');
     if(BigInt(row.quantity)>stock.quantity)throw new BusinessProblem('quantity_exceeds_available');
     const evidence=await document('evidence',{action:'OWNER_APPROVED_RECEIPT',requestId:row.request_id,chainRequestId:row.chain_request_id,
      requesterOrganizationId:row.requester_organization_id,requesterWallet:row.requester_wallet,approverOrganizationId:row.source_organization_id,
      trackingId:row.tracking_id,quantity:String(row.quantity),request:parse(row.request_json)});
     approval={tenantId:row.tenant_id,entityId:row.entity_id,sourceRouteId:row.source_route_id,receivedRouteId:row.received_route_id,
      requestId:row.chain_request_id,receiverWallet:row.requester_wallet,expectedVersion:String(stock.version),quantity:String(row.quantity),
      expiresAt:String(Math.floor(Number(row.expires_epoch))),evidenceHash:evidence};
     await conn.query('UPDATE receipt_requests SET prepared_json=? WHERE request_id=? AND lease_token=?',[JSON.stringify(approval),row.request_id,lease]);
    }
    const write=await businessWrite({accountId:row.approver_account_id,organizationId:row.source_organization_id,tenantId:row.tenant_id,entityId:row.entity_id,
     operation:'approveReceipt',args:[{...approval,expectedVersion:BigInt(approval.expectedVersion),quantity:BigInt(approval.quantity),expiresAt:BigInt(approval.expiresAt)}],idempotencyKey:'receipt_'+row.request_id,expectedEvent:'ReceiptApproved'});
    await conn.query(`UPDATE receipt_requests SET status=?,transaction_hash=?,result_json=?,error_code=NULL,lease_token=NULL,lease_until=NULL,
     next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 2 SECOND) WHERE request_id=? AND lease_token=?`,
     [write.status==='CONFIRMED'?'CONFIRMED':'APPROVING',write.transactionHash,JSON.stringify(write),row.request_id,lease]);
   }catch(error){
    const code=error instanceof BusinessProblem?error.code:'chain_unavailable',retry=transient.has(code);
    await conn.query(`UPDATE receipt_requests SET status=?,error_code=?,lease_token=NULL,lease_until=NULL,
     next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL ? SECOND) WHERE request_id=? AND lease_token=?`,
     [retry?'APPROVING':code==='request_expired'?'EXPIRED':'FAILED',code,Math.min(300,2**Math.min(Number(row.attempts),8)),row.request_id,lease]);
   }
   processed++;
  }finally{if(heartbeat)clearInterval(heartbeat);if(locked)await conn.query('SELECT RELEASE_LOCK(?)',[lock]);conn.release();}
 }
 return {processed};
}

export async function reconcileErpReceipts() {
 const [rows]=await db.query<RowDataPacket[]>(`SELECT o.operation_id,r.* FROM erp_operations o JOIN receipt_requests r ON r.request_id=JSON_UNQUOTE(JSON_EXTRACT(o.result_json,'$.receiptRequestId'))
  AND r.chain_id=o.chain_id AND r.contract_address=o.contract_address AND r.requester_organization_id=o.organization_id
  WHERE o.chain_id=? AND o.contract_address=? AND o.status='WAITING_APPROVAL' AND r.status NOT IN ('WAITING_APPROVAL','APPROVING') LIMIT 100`,[...scope]);
 for(const row of rows) {
  const status=row.status==='CONFIRMED'?'CONFIRMED':row.status==='FAILED'?'FAILED':'CANCELLED';
  await db.query("UPDATE erp_operations SET status=?,error_code=?,result_json=? WHERE operation_id=? AND status='WAITING_APPROVAL'",
   [status,row.error_code??(status==='CANCELLED'?'request_'+row.status.toLowerCase():null),JSON.stringify(result(row)),row.operation_id]);
 }
 return {updated:rows.length};
}
