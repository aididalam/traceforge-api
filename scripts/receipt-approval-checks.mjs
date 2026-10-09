import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Uses real HTTP, MySQL, signer journals and the deployed integration contract.
export async function receiptApprovalChecks(h) {
 const {request,read,sync,conn,actors,invoke,env,apiDist,checks,restartApi}=h;
 const [owner,receiver,other]=actors;
 const create=async(quantity=1,publish=true)=>{
  const response=await request('/products/create',{name:publish?'Receipt approval product':'PRIVATE_APPROVAL_SENTINEL',id:randomUUID(),quantity,publish,idempotencyKey:randomUUID()},owner.token);
  assert.equal(response.status,200,JSON.stringify(response.body));sync();
  return {...response.body,root:(await read('getProduct',[owner.user.tenantId,response.body.trackingId])).rootRouteId};
 };
 const receive=async(product,actor,quantity=1)=>{
  const response=await request('/products/'+product.trackingId+'/receive',{version:'0',confirmed:true,idempotencyKey:randomUUID(),...(quantity>1?{sourceRouteId:product.root,quantity}:{})},actor.token);
  assert.equal(response.status,202,JSON.stringify(response.body));assert.equal(response.body.status,'WAITING_APPROVAL');return response.body;
 };
 const decision=(actor,ids,action='approve',key=randomUUID())=>request('/receipt-requests/decisions',{requestIds:ids,action,idempotencyKey:key},actor.token);
 const worker=()=>invoke('api',apiDist+'/erp-worker.js',env,['--once']);
 const state=async(id)=>(await conn.query('SELECT * FROM receipt_requests WHERE request_id=?',[id]))[0][0];
 const batch=await create(10),a=await receive(batch,receiver,7),b=await receive(batch,other,7);
 assert.equal((await read('getBatchRoute',[owner.user.tenantId,batch.trackingId,batch.root])).availableQuantity,10n);
 assert.equal((await decision(receiver,[a.receiptRequestId])).body.results[0].error.code,'request_not_found');
 assert.equal((await decision(other,[a.receiptRequestId],'decline')).body.results[0].error.code,'request_not_found');
 const lists=(await request('/receipt-requests?direction=incoming',undefined,owner.token)).body;
 const visible=lists.requests.find(r=>r.id===a.receiptRequestId);
 const [wallet]=await conn.query('SELECT wallet_address FROM business_wallets WHERE organization_id=?',[receiver.user.organizationId]);
 assert.equal(visible.requester.id,receiver.user.organizationId);assert.equal(visible.requester.walletAddress,wallet[0].wallet_address.toLowerCase());
 // Independent API requests race against the same source, not only one bulk loop.
 const competed=await Promise.all([a,b].map(r=>decision(owner,[r.receiptRequestId])));
 assert.deepEqual(competed.map(r=>r.body.results[0].ok).sort(),[false,true]);
 assert.equal(competed.find(r=>!r.body.results[0].ok).body.results[0].error.code,'quantity_exceeds_available');
 const accepted=[a,b].find((_,i)=>competed[i].body.results[0].ok),rejected=[a,b].find((_,i)=>!competed[i].body.results[0].ok);
 await restartApi();
 await conn.query("UPDATE receipt_requests SET lease_token=?,lease_until=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 SECOND) WHERE request_id=?",[randomUUID(),accepted.receiptRequestId]);
 worker();sync();assert.equal((await state(accepted.receiptRequestId)).status,'CONFIRMED');
 assert.equal((await read('getBatchRoute',[owner.user.tenantId,batch.trackingId,batch.root])).availableQuantity,3n);
 assert.equal((await decision(owner,[accepted.receiptRequestId])).body.results[0].result.status,'CONFIRMED');
 assert.equal((await decision(owner,[rejected.receiptRequestId])).body.results[0].error.code,'quantity_exceeds_available');
 assert.equal((await decision(owner,[rejected.receiptRequestId],'decline')).body.results[0].result.status,'DECLINED');
 assert.equal((await decision(owner,[rejected.receiptRequestId])).body.results[0].error.code,'request_not_pending');
 checks.push('Concurrent owner approvals serialize against source quantity; no stock moves before approval, and approved requests recover after API restart and expired worker leases without duplicate transfers.');

 const single=await create(),cancelled=await receive(single,receiver),declined=await receive(single,other),maintenanceExpired=await receive(single,receiver);
 await conn.query('UPDATE receipt_requests SET expires_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 SECOND) WHERE request_id=?',[maintenanceExpired.receiptRequestId]);
 // Expiry maintenance must not wait for a live request locked by an approval.
 // The production list endpoint executes that maintenance before reading rows.
 await conn.beginTransaction();
 await conn.query('SELECT request_id FROM receipt_requests WHERE request_id=? FOR UPDATE',[cancelled.receiptRequestId]);
 const refreshing=request('/receipt-requests?direction=incoming',undefined,owner.token);
 let expiryTimer;
 try {
  const listing=await Promise.race([refreshing,new Promise((_,reject)=>{expiryTimer=setTimeout(()=>reject(Error('Expiry maintenance blocked on an unexpired receipt')),5000);})]);
  assert.equal(listing.status,200);assert.equal(listing.body.requests.find(r=>r.id===cancelled.receiptRequestId).status,'WAITING_APPROVAL');
  assert.equal(listing.body.requests.find(r=>r.id===maintenanceExpired.receiptRequestId).status,'EXPIRED');
 }finally{clearTimeout(expiryTimer);await conn.rollback();await refreshing.catch(()=>{});}
 checks.push('Expiry maintenance completes while a live pending receipt is locked, without blocking owner decisions or changing its stock.');
 assert.equal((await decision(owner,[cancelled.receiptRequestId],'cancel')).body.results[0].error.code,'request_not_found');
 assert.equal((await decision(receiver,[cancelled.receiptRequestId],'cancel')).body.results[0].result.status,'CANCELLED');
 assert.equal((await decision(owner,[declined.receiptRequestId],'decline')).body.results[0].result.status,'DECLINED');
 const expired=await receive(single,receiver);
 await conn.query('UPDATE receipt_requests SET expires_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 SECOND) WHERE request_id=?',[expired.receiptRequestId]);
 assert.equal((await decision(owner,[expired.receiptRequestId])).body.results[0].ok,false);
 assert.equal((await state(expired.receiptRequestId)).status,'EXPIRED');worker();
 assert.equal((await read('getEntity',[owner.user.tenantId,single.trackingId])).currentCustodian,owner.user.organizationId);
 const privateProduct=await create(1,false),privateRequest=await receive(privateProduct,receiver);
 const outgoing=(await request('/receipt-requests?direction=outgoing',undefined,receiver.token)).body;
 assert.equal(outgoing.requests.find(r=>r.id===privateRequest.receiptRequestId).name,null);
 assert.ok(!JSON.stringify(outgoing).includes('PRIVATE_APPROVAL_SENTINEL'));
 assert.equal((await decision(owner,[privateRequest.receiptRequestId],'decline')).body.results[0].ok,true);
 checks.push('Only the source business decides; only the requester cancels. Decline, cancellation and expiry preserve ownership. Pending receipts do not expose private product metadata.');

 const p1=await create(),p2=await create();
 const inputs=[p1,p2].map(p=>({trackingId:p.trackingId,version:'0',confirmed:true,idempotencyKey:randomUUID()}));
 const bulk=await request('/receipt-requests',{requests:inputs},receiver.token);assert.equal(bulk.status,202);
 assert.ok(bulk.body.results.every(r=>r.ok));
 const ids=bulk.body.results.map(r=>r.result.receiptRequestId);
 const replay=await request('/receipt-requests',{requests:inputs},receiver.token);assert.deepEqual(replay.body,bulk.body);
 const approved=await decision(owner,ids);assert.ok(approved.body.results.every(r=>r.ok));worker();sync();
 for(const p of [p1,p2])assert.equal((await read('getEntity',[owner.user.tenantId,p.trackingId])).currentCustodian,receiver.user.organizationId);
 const first=await request('/receipt-requests?direction=incoming&limit=1',undefined,owner.token);
 assert.equal(first.body.requests.length,1);assert.equal(first.body.page.hasMore,true);
 const second=await request('/receipt-requests?direction=incoming&limit=1&after='+first.body.page.next,undefined,owner.token);
 assert.notEqual(first.body.requests[0].id,second.body.requests[0].id);
 const [events]=await conn.query('SELECT requester_wallet,approver_wallet FROM receipt_approvals WHERE request_id IN (SELECT chain_request_id FROM receipt_requests WHERE request_id IN (?,?))',ids);
 assert.equal(events.length,2);assert.ok(events.every(e=>e.requester_wallet===wallet[0].wallet_address.toLowerCase()));
 checks.push('Bulk requests, idempotent replay, bulk approvals, newest-first pagination and requester/approver wallet projections match confirmed single-product custody.');
}
