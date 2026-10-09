import { productQuantity } from './product-input.js';
export const receiptStatuses = ['WAITING_APPROVAL','APPROVING','CONFIRMED','DECLINED','CANCELLED','EXPIRED','FAILED'] as const;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const version = /^(0|[1-9][0-9]{0,19})$/;
const key = /^[A-Za-z0-9_-]{8,64}$/;
export function validateReceiptInput(input: Record<string,unknown>) {
 if(Object.keys(input).some(k=>!['version','confirmed','idempotencyKey','sourceRouteId','quantity','integration'].includes(k)) ||
   input.confirmed!==true || typeof input.version!=='string' || !version.test(input.version) || BigInt(input.version)>18446744073709551615n ||
   typeof input.idempotencyKey!=='string' || !key.test(input.idempotencyKey) ||
   input.sourceRouteId!==undefined && (typeof input.sourceRouteId!=='string'||!bytes32Pattern.test(input.sourceRouteId))) throw Error('Invalid receipt request');
 productQuantity(input.quantity);
}
export function receiptDecisions(value:unknown):{requestIds:string[];action:'approve'|'decline'|'cancel';idempotencyKey:string} {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid decisions');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['requestIds','action','idempotencyKey'].includes(k))||
  !['approve','decline','cancel'].includes(String(v.action))||typeof v.idempotencyKey!=='string'||!key.test(v.idempotencyKey)||
  !Array.isArray(v.requestIds)||v.requestIds.length<1||v.requestIds.length>100||
  v.requestIds.some(id=>typeof id!=='string'||!uuidPattern.test(id))||new Set((v.requestIds as string[]).map(id=>id.toLowerCase())).size!==v.requestIds.length)throw Error('Invalid decisions');
 return {requestIds:(v.requestIds as string[]).map(id=>id.toLowerCase()),action:v.action as 'approve'|'decline'|'cancel',idempotencyKey:v.idempotencyKey};
}
