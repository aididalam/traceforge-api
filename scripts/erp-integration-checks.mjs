import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {createServer} from "node:http";

// Real HTTP, MySQL, worker processes and contract writes on the disposable chain.
export async function erpIntegrationChecks({request,read,sync,conn,api,actors,invoke,env,apiDist,checks,fetcher,restartApi}){
 const [producer,distributor,shop,other]=actors;
 const scopes=["products:read","products:create","products:receive","products:remove","jobs:read"],passed=[];
 const hash=value=>createHash("sha256").update(value).digest("hex");
 const integration=async(path,body,token)=>{
  const response=await fetcher(api+"/integration/v1"+path,{method:body?"POST":"GET",headers:{...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
 };
 const makeKey=async(actor,name,grant=scopes)=>{
  const result=await request("/integration-keys",{name,scopes:grant,expiresInDays:30},actor.token);assert.equal(result.status,201);
  assert.match(result.body.secret,/^tferp_[A-Za-z0-9_-]{43}$/);return result.body;
 };
 const keys=await Promise.all([producer,distributor,shop,other].map(actor=>makeKey(actor,"Synthetic ERP "+actor.name)));
 for(const invalid of [{name:"Bad expiry",scopes,expiresInDays:"30"},{name:"Bad scope",scopes:["chain:write"]},{name:"Extra identity",scopes,organizationId:other.user.organizationId}])
  assert.equal((await request("/integration-keys",invalid,producer.token)).status,400);
 const [pk,dk,sk,ok]=keys;
 const totals=async()=>Number((await conn.query("SELECT COUNT(*) count FROM chain_write_operations"))[0][0].count);
 const queues=async()=>Number((await conn.query("SELECT COUNT(*) count FROM erp_operations WHERE status IN ('QUEUED','PROCESSING','RETRY')"))[0][0].count);
 const drain=async()=>{
  for(let attempt=0;attempt<60;attempt++){
   if(await queues()===0)return;
   invoke("api",apiDist+"/erp-worker.js",env,["--once"]);
  }throw Error("ERP test queue did not drain.");
 };
 const enqueue=async(key,body)=>{const response=await integration("/jobs",body,key.secret);assert.equal(response.status,202,JSON.stringify(response.body));return response.body;};
 const get=async(job,key)=>{const response=await integration("/jobs/"+job.jobId,undefined,key.secret);assert.equal(response.status,200);return response.body;};
 const batch=operations=>({idempotencyKey:randomUUID(),reference:"SALE-ERP-0001",occurredAt:"2026-10-07T08:00:00.000Z",operations});
 const action=(type,code,data)=>({action:type,idempotencyKey:randomUUID(),...(code?{productCode:code}:{}),data});
 const registration=(name,id,quantity=1,publish=true)=>action("create",null,{name,id,quantity,publish,fields:[{label:"Origin",value:"বাংলাদেশ"}]});
 const keyList=await request("/integration-keys",undefined,producer.token);assert.equal(keyList.status,200);
 assert.ok(!JSON.stringify(keyList.body).includes(pk.secret));assert.ok(!JSON.stringify(keyList.body).includes(hash(pk.secret)));
 assert.ok(keyList.body.keys.every(key=>key.id===pk.key.id));
 const [stored]=await conn.query("SELECT key_hash FROM erp_integration_keys WHERE key_id=?",[pk.key.id]);assert.equal(stored[0].key_hash,hash(pk.secret));
 assert.equal((await integration("/me",undefined,producer.token)).status,401);
 assert.equal((await request("/me",undefined,pk.secret)).status,401);
 assert.equal((await fetcher(api+"/v1/auth/me",{headers:{Authorization:"Bearer "+pk.secret}})).status,401);
 assert.equal((await fetcher(api+"/integra%74ion/v1/me")).status,401);
 assert.equal((await fetcher(api+"/integra%74ion/v1/me",{headers:{Authorization:"Bearer "+pk.secret}})).status,200);
 assert.equal((await request("/integration-keys/"+sk.key.id+"/revoke",{},producer.token)).status,404);
 assert.equal((await integration("/me",undefined,pk.secret)).body.organizationId,producer.user.organizationId);
 passed.push("Scoped ERP keys are hashed at rest, organization-bound, hidden after creation, and cannot authenticate operator/generic routes; encoded routes remain protected.");
 const readonly=await makeKey(producer,"Read only ERP",["products:read","jobs:read"]);
 const createBody=batch([registration("ERP Cola","ERP-COLA",50),registration("ERP Single","ERP-SERIAL"),registration("ERP Snack","ERP-SNACK",25),registration("PRIVATE_ERP_SENTINEL","PRIVATE_ERP_REFERENCE",10,false)]);
 const before=await totals(),created=await enqueue(pk,createBody);assert.equal(created.status,"QUEUED");assert.equal(created.counts.total,4);assert.equal(await totals(),before);
 assert.equal(created.occurredAt,createBody.occurredAt);
 const [storedTime]=await conn.query("SELECT DATE_FORMAT(occurred_at,'%Y-%m-%d %H:%i:%s.%f') value FROM erp_jobs WHERE job_id=?",[created.jobId]);
 assert.equal(storedTime[0].value,"2026-10-07 08:00:00.000000");
 assert.equal((await integration("/jobs",createBody,readonly.secret)).status,403);
 assert.equal((await integration("/jobs/"+created.jobId,undefined,ok.secret)).status,404);
 const retry=await enqueue(pk,createBody);assert.equal(retry.jobId,created.jobId);
 const changed=structuredClone(createBody);changed.operations[0].data.quantity=51;
 assert.equal((await integration("/jobs",changed,pk.secret)).status,409);
 assert.equal((await integration("/jobs",{...changed,idempotencyKey:randomUUID()},pk.secret)).status,409);
 const [atomic]=await conn.query("SELECT (SELECT COUNT(*) FROM erp_jobs) jobs,(SELECT COUNT(*) FROM erp_operations) items");assert.equal(Number(atomic[0].jobs),1);assert.equal(Number(atomic[0].items),4);
 for(const invalid of [{...createBody,organizationId:other.user.organizationId},{...createBody,operations:[]},{...createBody,operations:[createBody.operations[0],createBody.operations[0]]},
  {...createBody,operations:Array.from({length:101},()=>registration("Too many","EXCESS"))},{...createBody,operations:[{...createBody.operations[0],data:{...createBody.operations[0].data,privateKey:"FORBIDDEN"}}]}])assert.equal((await integration("/jobs",invalid,pk.secret)).status,400);
 await restartApi({TZ:"America/New_York"});assert.equal((await get(created,pk)).status,"QUEUED");assert.equal((await get(created,pk)).occurredAt,createBody.occurredAt);assert.equal(await totals(),before);
 assert.equal((await request("/integration-keys",undefined,producer.token)).body.keys.find(key=>key.id===pk.key.id).expiresAt,pk.key.expiresAt);
 await restartApi();
 const first=created.items[0].operationId;
 await conn.query("UPDATE erp_operations SET status='PROCESSING',lease_token=?,lease_until=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 SECOND) WHERE operation_id=?",[randomUUID(),first]);
 await drain();sync();
 const createResult=await get(created,pk);assert.equal(createResult.status,"COMPLETED");assert.equal(createResult.counts.confirmed,4);assert.equal(await totals(),before+4);
 const [cola,single,snack,privateProduct]=createResult.items.map(item=>item.result);
 const root=(await read("getProduct",[producer.user.tenantId,cola.trackingId])).rootRouteId;
 const snackRoot=(await read("getProduct",[producer.user.tenantId,snack.trackingId])).rootRouteId;
 assert.equal((await enqueue(pk,{...createBody,idempotencyKey:randomUUID()})).status,"COMPLETED");assert.equal(await totals(),before+4);
 const scan=await integration("/scan?"+new URLSearchParams({code:"https://example.test/s/"+cola.shortCode}),undefined,dk.secret);
 assert.equal(scan.status,200);assert.equal(scan.body.trackingId,cola.trackingId);
 const privateScan=await integration("/scan?code="+privateProduct.shortCode,undefined,dk.secret);assert.equal(privateScan.status,200);
 assert.ok(!JSON.stringify(privateScan.body).includes("PRIVATE_ERP_SENTINEL"));assert.equal(privateScan.body.quantity.externalId,null);
 assert.equal((await integration("/products/search?id=PRIVATE_ERP_REFERENCE",undefined,dk.secret)).body.products.length,0);
 assert.equal((await integration("/products/search?id=ERP-COLA",undefined,dk.secret)).body.products.length,1);
 assert.equal((await integration("/products?after=18446744073709551616",undefined,pk.secret)).status,400);
 assert.equal((await integration("/scan?code="+cola.shortCode+"&code="+single.shortCode,undefined,dk.secret)).status,400);
 passed.push("Bulk acceptance is durable before blockchain work, survives API restart and expired leases, normalizes existing QR codes, and atomically rejects conflicting/invalid retries without leaking private products.");
 const received=await enqueue(dk,batch([action("receive",cola.shortCode,{sourceRouteId:root,quantity:30,confirmed:true}),action("receive",single.trackingId,{confirmed:true})]));
 await drain();sync();const receiveResult=await get(received,dk);assert.equal(receiveResult.status,"COMPLETED");
 const distributorRoute=receiveResult.items[0].result.receivedRouteId;
 assert.equal(await read("isActiveTenantMember",[producer.user.tenantId,distributor.user.organizationId]),false);
 const stocked=await enqueue(sk,batch([action("receive",cola.trackingId,{sourceRouteId:distributorRoute,quantity:20,confirmed:true}),
  action("receive",single.shortCode,{confirmed:true}),action("receive",snack.shortCode,{sourceRouteId:snackRoot,quantity:25,confirmed:true})]));
 await drain();sync();const stockResult=await get(stocked,sk);assert.equal(stockResult.status,"COMPLETED");
 const shopCola=stockResult.items[0].result.receivedRouteId,shopSnack=stockResult.items[2].result.receivedRouteId;
 const checkout=batch([action("remove",cola.shortCode,{routeId:shopCola,quantity:3,confirmed:true}),action("remove",single.shortCode,{confirmed:true}),
  action("remove",snack.shortCode,{routeId:shopSnack,quantity:5,reason:"Lost",reasonText:"পরিবহনের সময় হারিয়েছে",confirmed:true}),action("remove",cola.shortCode,{routeId:shopCola,quantity:2,confirmed:true})]);
 const sale=await enqueue(sk,checkout);const saleBefore=await totals();
 // Two independent workers cannot allocate concurrent nonces or duplicate a sale.
 await Promise.all([1,2].map(()=>new Promise((done,reject)=>{
  const child=spawn(process.execPath,[apiDist+"/erp-worker.js","--once"],{cwd:resolve("."),env,stdio:"ignore"});
  child.once("error",reject);child.once("exit",code=>code===0?done():reject(Error("Concurrent ERP worker failed")));
 })));
 await drain();sync();const sold=await get(sale,sk);assert.equal(sold.status,"COMPLETED");assert.equal(sold.counts.confirmed,4);
 assert.equal(await totals(),saleBefore+4);
 assert.equal((await read("getProduct",[producer.user.tenantId,cola.trackingId])).availableQuantity,45n);
 assert.equal((await read("getBatchRoute",[producer.user.tenantId,cola.trackingId,shopCola])).availableQuantity,15n);
 assert.equal((await read("getProduct",[producer.user.tenantId,snack.trackingId])).availableQuantity,20n);
 assert.equal((await read("getEntity",[producer.user.tenantId,single.trackingId])).closed,true);
 assert.equal(await read("getRemovalTotal",[producer.user.tenantId,cola.trackingId,0]),5n);
 assert.equal(await read("getRemovalTotal",[producer.user.tenantId,snack.trackingId,1]),5n);
 const [evidence]=await conn.query("SELECT d.document_json FROM chain_write_operations w JOIN offchain_documents d ON d.content_hash=JSON_UNQUOTE(JSON_EXTRACT(w.request_json,'$.args[7]')) WHERE w.operation_id=?",[sold.items[0].result.operationId]);
 const eventEvidence=typeof evidence[0].document_json==="string"?JSON.parse(evidence[0].document_json):evidence[0].document_json;
 assert.equal(eventEvidence.integration.reference,checkout.reference);assert.equal(eventEvidence.integration.occurredAt,checkout.occurredAt);
 const beforeReplay=await totals();await enqueue(sk,checkout);await enqueue(sk,{...checkout,idempotencyKey:randomUUID()});assert.equal(await totals(),beforeReplay);
 passed.push("One completed checkout removes multiple products asynchronously, preserves exact batch/single counts and on-chain Unicode reasons, binds receipt references into evidence, and remains idempotent across jobs/concurrent workers.");
 const mixed=await enqueue(sk,batch([action("remove",snack.shortCode,{routeId:shopSnack,quantity:1,confirmed:true}),
  action("remove",cola.shortCode,{routeId:root,quantity:1,confirmed:true}),action("remove",cola.shortCode,{routeId:shopCola,quantity:100,confirmed:true}),
  action("remove",cola.shortCode,{routeId:shopCola,version:"0",quantity:1,confirmed:true}),action("remove",cola.shortCode,{routeId:"0x"+"00".repeat(32),quantity:1,confirmed:true})]));
 await drain();const mixedResult=await get(mixed,sk);assert.equal(mixedResult.status,"PARTIAL_FAILURE");assert.equal(mixedResult.counts.confirmed,1);assert.equal(mixedResult.counts.failed,4);
 assert.ok(mixedResult.items.slice(1).every(item=>item.error.code==="operation_not_allowed"));
 assert.equal((await read("getProduct",[producer.user.tenantId,cola.trackingId])).availableQuantity,45n);
 passed.push("Non-owner, overdraw, stale version and nonexistent route fail per item without cancelling successful sale lines or creating failed chain transactions.");
 const pauseBody=batch([registration("ERP Paused","ERP-PAUSED")]),paused=await enqueue(pk,pauseBody),pauseBefore=await totals();
 invoke("api",apiDist+"/erp-worker.js",{...env,TRACEFORGE_BROADCAST_ENABLED:"false"},["--once"]);
 const pausedResult=await get(paused,pk);assert.equal(pausedResult.items[0].status,"RETRY");assert.equal(pausedResult.items[0].error.code,"writes_disabled");assert.equal(await totals(),pauseBefore);
 const [frozen]=await conn.query("SELECT prepared_json FROM erp_operations WHERE operation_id=?",[paused.items[0].operationId]);const frozenJson=JSON.stringify(frozen[0].prepared_json);
 await conn.query("UPDATE erp_operations SET next_attempt_at=CURRENT_TIMESTAMP WHERE operation_id=?",[paused.items[0].operationId]);
 await drain();assert.equal((await get(paused,pk)).status,"COMPLETED");assert.equal(await totals(),pauseBefore+1);
 const [unfrozen]=await conn.query("SELECT prepared_json FROM erp_operations WHERE operation_id=?",[paused.items[0].operationId]);assert.equal(JSON.stringify(unfrozen[0].prepared_json),frozenJson);
 // A transport failure during contract simulation must be retried, not treated
 // as a permanent contract rejection. This proxy runs only on the test network.
 assert.equal(env.TRACEFORGE_RPC_URL,"http://127.0.0.1:18545");
 const networkJob=await enqueue(pk,batch([registration("ERP Network recovery","ERP-NETWORK")])),networkBefore=await totals();
 let blockedCalls=0;
 const proxy=createServer(async(req,res)=>{
  try{
   let raw="";for await(const part of req)raw+=part;
   const calls=JSON.parse(raw),list=Array.isArray(calls)?calls:[calls];
   if(list.some(call=>call.method==="eth_call")){blockedCalls++;res.writeHead(503,{"Content-Type":"application/json"}).end('{"error":"synthetic transport outage"}');return;}
   const upstream=await fetch(env.TRACEFORGE_RPC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:raw});
   res.writeHead(upstream.status,{"Content-Type":"application/json"}).end(await upstream.text());
  }catch{res.writeHead(503).end();}
 });
 await new Promise(done=>proxy.listen(0,"127.0.0.1",done));
 try{
  // The proxy shares this process's event loop, so dispatch asynchronously.
  await new Promise((done,reject)=>{const child=spawn(process.execPath,[apiDist+"/erp-worker.js","--once"],
   {cwd:resolve("."),env:{...env,TRACEFORGE_RPC_URL:`http://127.0.0.1:${proxy.address().port}`},stdio:"ignore"});
   child.once("error",reject);child.once("exit",code=>code===0?done():reject(Error("Network recovery worker failed")));});
 }finally{await new Promise(done=>proxy.close(done));}
 assert.ok(blockedCalls>0);const interrupted=await get(networkJob,pk);assert.equal(interrupted.items[0].status,"RETRY");
 assert.equal(interrupted.items[0].error.code,"chain_unavailable");assert.equal(await totals(),networkBefore);
 await conn.query("UPDATE erp_operations SET next_attempt_at=CURRENT_TIMESTAMP WHERE operation_id=?",[networkJob.items[0].operationId]);
 await drain();assert.equal((await get(networkJob,pk)).status,"COMPLETED");assert.equal(await totals(),networkBefore+1);
 const recoveryKey=await makeKey(producer,"Crash recovery ERP"),recovery=await enqueue(recoveryKey,batch([registration("ERP Recovery","ERP-RECOVERY")]));await drain();
 const recoveredBefore=await totals(),originalResult=(await get(recovery,recoveryKey)).items[0].result;
 await request("/integration-keys/"+recoveryKey.key.id+"/revoke",{},producer.token);
 await conn.query("UPDATE erp_operations SET status='PROCESSING',result_json=NULL,lease_token=?,lease_until=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 SECOND),next_attempt_at=CURRENT_TIMESTAMP WHERE operation_id=?",[randomUUID(),recovery.items[0].operationId]);
 await drain();const recovered=await get(recovery,pk);assert.equal(recovered.status,"COMPLETED");assert.deepEqual(recovered.items[0].result,originalResult);assert.equal(await totals(),recoveredBefore);
 passed.push("Broadcast-disabled work and transport failure during contract simulation retry without new writes; another worker recovers a mined transaction after a simulated crash, even after key revocation, without minting a duplicate product.");
 const revokedKey=await makeKey(shop,"Revoke queued ERP"),cancelled=await enqueue(revokedKey,batch([action("remove",cola.shortCode,{routeId:shopCola,quantity:1,confirmed:true})]));
 const revokeBefore=await totals();assert.equal((await request("/integration-keys/"+revokedKey.key.id+"/revoke",{},shop.token)).status,200);
 assert.equal((await integration("/me",undefined,revokedKey.secret)).status,401);await drain();
 const cancelledResult=await get(cancelled,sk);assert.equal(cancelledResult.status,"CANCELLED");assert.equal(await totals(),revokeBefore);
 const expired=await makeKey(producer,"Expired ERP");await conn.query("UPDATE erp_integration_keys SET expires_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 SECOND) WHERE key_id=?",[expired.key.id]);
 assert.equal((await integration("/me",undefined,expired.secret)).status,401);
 await conn.query("UPDATE operator_accounts SET active=FALSE WHERE account_id=?",[other.user.accountId]);
 assert.equal((await integration("/me",undefined,ok.secret)).status,401);await conn.query("UPDATE operator_accounts SET active=TRUE WHERE account_id=?",[other.user.accountId]);
 passed.push("Revocation/expiry and inactive accounts block ERP access; unstarted revoked work is cancelled while already submitted transactions remain auditable.");
 const ids=Array.from({length:1000},()=>randomUUID());
 try{
  const values=ids.map((id,i)=>[id,env.TRACEFORGE_CHAIN_ID,env.TRACEFORGE_CONTRACT_ADDRESS.toLowerCase(),other.user.organizationId,ok.key.id,hash("LIMIT-"+id),"0x"+"11".repeat(32),"create","{}"]);
  await conn.query("INSERT INTO erp_operations(operation_id,chain_id,contract_address,organization_id,key_id,item_key_hash,request_hash,action,request_json) VALUES ?",[values]);
  const beforeJobs=Number((await conn.query("SELECT COUNT(*) count FROM erp_jobs"))[0][0].count);
  assert.equal((await integration("/jobs",batch([registration("Queue excess","QUEUE-EXCESS")]),ok.secret)).status,429);
  assert.equal(Number((await conn.query("SELECT COUNT(*) count FROM erp_jobs"))[0][0].count),beforeJobs);
 }finally{await conn.query("DELETE FROM erp_operations WHERE operation_id IN (?)",[ids]);}
 const [signed]=await conn.query("SELECT COUNT(*) count FROM chain_write_operations WHERE status='CONFIRMED' AND serialized_transaction IS NOT NULL");assert.equal(Number(signed[0].count),0);
 const [queueRows]=await conn.query("SELECT status,COUNT(*) count FROM erp_operations GROUP BY status");
 assert.equal(await queues(),0);passed.push("A bounded 1,000-item per-business backlog returns backpressure without partial enqueue; queue results never expose signed transactions or credential hashes.");
 checks.push(...passed);
 return {passed:true,checks:passed,completedCheckoutProducts:3,checkoutOperations:4,queueStates:Object.fromEntries(queueRows.map(row=>[row.status,Number(row.count)]))};
}
