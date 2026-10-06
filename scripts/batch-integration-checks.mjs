import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readdir} from "node:fs/promises";
import mysql from "mysql2/promise";
import {loadSourceFile} from "./test-source-loader.mjs";

// Runs inside the disposable direct-claim harness, never against a live service.
export async function batchChecks({request,read,sync,conn,api,actors,invoke,env,indexerDist,checks,fetcher}){
 const [producer,distributor,shop,other]=actors;
 const create=async(actor,id,quantity,publish=true)=>{
  const body={name:publish?"Integration batch":"PRIVATE_BATCH_SENTINEL",id,quantity,publish,idempotencyKey:randomUUID(),fields:[{label:"Origin",value:"বাংলাদেশ"}]};
  const result=await request("/products/create",body,actor.token);
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.status,"CONFIRMED");
  assert.match(result.body.shortCode,/^[a-z0-9]{12}$/);
  const retry=await request("/products/create",body,actor.token);assert.deepEqual(retry.body,result.body);
  assert.equal((await request("/products/create",{...body,quantity:quantity+1},actor.token)).status,409);
  return result.body;
 };
 const body={name:"Invalid",id:"INVALID",publish:false,idempotencyKey:randomUUID()};
 const [before]=await conn.query("SELECT COUNT(*) AS total FROM offchain_documents");
 for(const quantity of [null,true,"10",0,-1,1.5,Number.MAX_SAFE_INTEGER+1])
  assert.equal((await request("/products/create",{...body,quantity},producer.token)).status,400);
 for(const id of [null,3," ","bad\nID","bad\uD800"])
  assert.equal((await request("/products/create",{...body,id},producer.token)).status,400);
 assert.equal((await request("/products/create",{...body,fields:[{label:"Quantity",value:"100"}]},producer.token)).status,400);
 const [after]=await conn.query("SELECT COUNT(*) AS total FROM offchain_documents");assert.equal(after[0].total,before[0].total);
 const batch=await create(producer,"BATCH-DUP",1000000);
 // An alias exists as soon as the registration confirms, before projection.
 assert.equal((await request("/receive/"+batch.shortCode,undefined,distributor.token)).status,503);
 sync();
 const duplicate=await create(other,"BATCH-DUP",1),sameBusiness=await create(producer,"BATCH-DUP",2);
 const privateBatch=await create(other,"BATCH-DUP",100,false);sync();
 assert.equal((await fetcher(api+"/public/v1/short-links/"+privateBatch.shortCode)).status,404);
 const privatePreview=await request("/receive/"+privateBatch.shortCode,undefined,distributor.token);
 assert.equal(privatePreview.status,200,JSON.stringify(privatePreview.body));assert.equal(privatePreview.body.name,null);
 assert.equal(privatePreview.body.quantity.externalId,null);assert.ok(!JSON.stringify(privatePreview.body).includes("PRIVATE_BATCH_SENTINEL"));
 assert.equal((await fetcher(api+"/public/v1/products/"+privateBatch.trackingId+"/quantity")).status,404);
 assert.equal((await fetcher(api+"/public/v1/products/"+privateBatch.trackingId+"/routes")).status,404);
 const search=async(query,actor)=>actor?request("/products/search?"+query,undefined,actor.token):
  {status:200,body:await (await fetcher(api+"/public/v1/products/search?"+query)).json()};
 let result=await search("id=BATCH-DUP");assert.equal(result.body.products.length,3);assert.ok(!JSON.stringify(result.body).includes("PRIVATE_BATCH_SENTINEL"));
 const all=[];let cursor="0";
 do{const page=await search("id=BATCH-DUP&limit=1&after="+cursor);all.push(...page.body.products);cursor=page.body.page.next;}while(cursor);
 assert.equal(new Set(all.map(p=>p.trackingId)).size,3);
 assert.equal((await search("id=batch-dup")).body.products.length,0);
 assert.equal((await search("id=BATCH-DUP",producer)).body.products.length,3);
 assert.equal((await search("id=BATCH-DUP",other)).body.products.length,4);
 const me=(await request("/me",undefined,producer.token)).body.user;
 assert.match(me.businessCode,/^[A-Z0-9]{1,16}$/);
 assert.equal((await search("id=BATCH-DUP&businessCode="+me.businessCode.toLowerCase())).body.products.length,2);
 const singleHolders=await (await fetcher(api+"/public/v1/products/"+duplicate.trackingId+"/holders")).json();
 assert.equal(singleHolders.holders[0].availableQuantity,"1");assert.equal(singleHolders.holders[0].id,other.user.organizationId);
 checks.push("Registration validates required IDs/counts before storage; duplicate business IDs remain separate records, with confirmed unique aliases including private registrations and exact paginated public search.");
 const id=batch.trackingId,tenant=producer.user.tenantId;
 const product=await read("getProduct",[tenant,id]),root=product.rootRouteId;
 assert.equal(product.initialQuantity,1000000n);
 const receive=async(actor,sourceRouteId,version,quantity)=>{
  const body={sourceRouteId,version:String(version),quantity,confirmed:true,idempotencyKey:randomUUID()};
  const result=await request("/products/"+id+"/receive",body,actor.token);
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.status,"CONFIRMED");
  assert.deepEqual((await request("/products/"+id+"/receive",body,actor.token)).body,result.body);
  assert.equal((await request("/products/"+id+"/receive",{...body,quantity:quantity+1},actor.token)).status,409);
  sync();return result.body.receivedRouteId;
 };
 const distFirst=await receive(distributor,root,0,400000);
 const shopFirst=await receive(shop,root,1,300000);
 const distSecond=await receive(distributor,root,2,50000);
 const shopSecond=await receive(shop,distFirst,0,100000);
 const returned=await receive(producer,shopSecond,0,50000);
 assert.notEqual(distFirst,distSecond);assert.notEqual(root,returned);
 assert.equal(await read("isActiveTenantMember",[tenant,distributor.user.organizationId]),false);
 const rejectReceive=async(actor,route,version,quantity)=>request("/products/"+id+"/receive",{sourceRouteId:route,version:String(version),quantity,confirmed:true,idempotencyKey:randomUUID()},actor.token);
 assert.equal((await rejectReceive(shop,root,0,1)).status,409);
 assert.equal((await rejectReceive(shop,root,3,250001)).status,409);
 assert.equal((await rejectReceive(distributor,distFirst,1,1)).status,409);
 const quantity=async()=> (await fetcher(api+"/public/v1/products/"+id+"/quantity")).json();
 assert.equal((await quantity()).availableQuantity,"1000000");
 let holders=await (await fetcher(api+"/public/v1/products/"+id+"/holders?limit=1")).json();
 assert.equal(holders.holders.length,1);assert.equal(holders.page.hasMore,true);
 const holderMap=new Map();let holderCursor="0x"+"0".repeat(64);
 do{const page=await (await fetcher(api+"/public/v1/products/"+id+"/holders?limit=1&after="+holderCursor)).json();
  page.holders.forEach(h=>holderMap.set(h.id,h));holderCursor=page.page.next;}while(holderCursor);
 assert.equal(holderMap.size,3);assert.equal(holderMap.get(distributor.user.organizationId).availableQuantity,"350000");
 assert.equal(holderMap.get(shop.user.organizationId).availableQuantity,"350000");
 assert.equal(holderMap.get(producer.user.organizationId).availableQuantity,"300000");
 const inventory=(await request("/products",undefined,distributor.token)).body.products.find(p=>p.id===id);
 assert.equal(inventory.quantity.ownAvailableQuantity,"350000");assert.equal(inventory.holder,null);
 const paged=[];let routeCursor="0";
 do{const page=await request("/products/"+id+"/routes?limit=1&after="+routeCursor,undefined,distributor.token);
  assert.equal(page.status,200);paged.push(...page.body.routes);routeCursor=page.body.page.next;}while(routeCursor);
 assert.equal(paged.length,6);assert.equal(paged.reduce((sum,r)=>sum+BigInt(r.availableQuantity),0n),1000000n);
 assert.equal(paged.find(r=>r.id===returned).parentRouteId,shopSecond);
 await conn.query("UPDATE business_wallets SET public_profile=FALSE WHERE organization_id=?",[shop.user.organizationId]);
 const hidden=(await request("/products/"+id+"/routes",undefined,distributor.token)).body.routes.filter(r=>r.owner.id===shop.user.organizationId);
 assert.ok(hidden.every(r=>r.owner.name===null));
 const consentHistory=await (await fetcher(api+`/public/v1/tenants/${tenant}/entities/${id}/history`)).json();
 assert.ok(consentHistory.events.filter(e=>e.organization?.id===shop.user.organizationId).every(e=>e.organization.name===null));
 await conn.query("UPDATE business_wallets SET public_profile=TRUE WHERE organization_id=?",[shop.user.organizationId]);
 checks.push("Partial receipts conserve global quantity, aggregate stock across six independent paths and three holders, preserve return lineage, paginate without changing totals, and reject stale/oversized/self receipts.");
 const remove=async(actor,routeId,version,count,reason="Sold",reasonText="")=>{
  const body={routeId,version:String(version),quantity:count,reason,reasonText,confirmed:true,idempotencyKey:randomUUID()};
  const result=await request("/products/"+id+"/remove",body,actor.token);
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.status,"CONFIRMED");
  assert.deepEqual((await request("/products/"+id+"/remove",body,actor.token)).body,result.body);
  assert.equal((await request("/products/"+id+"/remove",{...body,quantity:count+1},actor.token)).status,409);sync();
 };
 const invalidRemoval={routeId:root,version:"3",quantity:1,confirmed:true,idempotencyKey:randomUUID()};
 assert.equal((await request("/products/"+id+"/remove",{...invalidRemoval,reason:"Lost"},producer.token)).status,400);
 assert.equal((await request("/products/"+id+"/remove",invalidRemoval,shop.token)).status,409);
 assert.equal((await request("/products/"+id+"/remove",{...invalidRemoval,quantity:250001},producer.token)).status,409);
 await remove(producer,root,3,100000);
 await remove(shop,shopFirst,0,100000,"Lost","পরিবহনের সময় হারিয়েছে");
 await remove(distributor,distFirst,1,50000,"Damaged","Broken packages");
 const summary=await quantity();assert.equal(summary.availableQuantity,"750000");assert.equal(summary.removedQuantity,"250000");
 assert.equal(summary.reasons.find(r=>r.reason==="Lost").quantity,"100000");
 const [stored]=await conn.query("SELECT reason_text FROM quantity_movements WHERE entity_id=? AND reason=1",[id]);assert.equal(stored[0].reason_text,"পরিবহনের সময় হারিয়েছে");
 assert.equal(await read("getRemovalTotal",[tenant,id,1]),100000n);
 const publicRef=await (await fetcher(api+"/public/v1/tracking/"+id)).json();
 const historyPath=`/public/v1/tenants/${publicRef.tenantId}/entities/${publicRef.entityId}/history`;
 const history=await (await fetcher(api+historyPath)).json();assert.equal(history.entity.quantity.availableQuantity,"750000");
 assert.equal(history.events.filter(e=>e.eventName==="ProductRegistered").length,1);
 assert.equal(history.events.filter(e=>e.eventName==="EntityCreated").length,0);
 assert.equal(history.events.filter(e=>e.eventName==="QuantityRemoved").length,3);
 assert.ok(history.events.every(e=>e.occurredAt!==null));
 assert.equal(history.events.find(e=>e.quantity?.reason==="Lost").quantity.reasonText,"পরিবহনের সময় হারিয়েছে");
 const active=(await request("/products/"+id+"/routes",undefined,producer.token)).body.routes;
 for(const route of active){const actor=actors.find(a=>a.user.organizationId===route.owner.id);await remove(actor,route.id,route.version,Number(route.availableQuantity));}
 const ended=await quantity();assert.equal(ended.availableQuantity,"0");assert.equal(ended.removedQuantity,"1000000");assert.equal(ended.isBatch,true);assert.equal(ended.inSupplyChain,false);
 assert.equal((await read("getEntity",[tenant,id])).closed,true);
 assert.equal((await fetcher(api+"/public/v1/products/"+id+"/routes")).status,200);
 assert.equal((await (await fetcher(api+"/public/v1/products/"+id+"/routes")).json()).routes.length,0);
 assert.equal((await rejectReceive(shop,root,4,1)).status,409);
 const [movements]=await conn.query("SELECT COUNT(*) AS total FROM quantity_movements WHERE entity_id=? AND action='REMOVED'",[id]);assert.equal(Number(movements[0].total),9);
 checks.push("One 100,000-item removal produces one event; owner-only removals preserve written on-chain reasons and category totals, and the batch closes only after all routes reach zero.");
 const race=await create(producer,"CONCURRENT",10);sync();
 const raceRoot=(await read("getProduct",[tenant,race.trackingId])).rootRouteId;
 const raceResults=await Promise.all([distributor,shop].map(actor=>request("/products/"+race.trackingId+"/receive",{sourceRouteId:raceRoot,version:"0",quantity:7,confirmed:true,idempotencyKey:randomUUID()},actor.token)));
 assert.deepEqual(raceResults.map(r=>r.status).sort(),[200,409]);sync();
 assert.equal((await read("getBatchRoute",[tenant,race.trackingId,raceRoot])).availableQuantity,3n);
 checks.push("Simultaneous receivers of the same source version cannot overdraw stock: exactly one transaction confirms.");
 const {quantitySummary}=await loadSourceFile("src/product-quantity.ts");
 assert.equal(await quantitySummary(conn,[9009,"0x"+"ff".repeat(20)],tenant,id),null);
 // Rebuild and incremental replay must be equivalent, and corrupt input must roll back.
 const snapshot=async()=>JSON.stringify((await conn.query("SELECT * FROM product_quantities ORDER BY entity_id"))[0]);
 const originalSnapshot=await snapshot();invoke("indexer",indexerDist+"/project.js",env);assert.equal(await snapshot(),originalSnapshot);
 invoke("indexer",indexerDist+"/project.js",env,["--rebuild"]);assert.equal(await snapshot(),originalSnapshot);
 const [last]=await conn.query("SELECT id,event_args FROM chain_events WHERE event_name='QuantityRemoved' AND JSON_UNQUOTE(JSON_EXTRACT(event_args,'$.entityId'))=? ORDER BY id DESC LIMIT 1",[id]);
 const originalArgs=typeof last[0].event_args==="string"?last[0].event_args:JSON.stringify(last[0].event_args);
 const corrupt=JSON.parse(originalArgs);corrupt.quantity="999999999";
 await conn.query("UPDATE chain_events SET event_args=? WHERE id=?",[JSON.stringify(corrupt),last[0].id]);
 assert.throws(()=>invoke("indexer",indexerDist+"/project.js",env,["--rebuild"]));assert.equal(await snapshot(),originalSnapshot);
 await conn.query("UPDATE chain_events SET event_args=? WHERE id=?",[originalArgs,last[0].id]);
 invoke("indexer",indexerDist+"/project.js",env,["--rebuild"]);assert.equal(await snapshot(),originalSnapshot);
 checks.push("Projection is repeatable and rebuildable, rejects inconsistent quantity events atomically, and quantity queries are isolated by contract deployment.");
 await allocatorChecks(conn,actors,checks);
 await concurrentCodes(conn,env,actors,checks);
 const filesBefore=(await readdir(env.TRACEFORGE_BUSINESS_WALLET_DIRECTORY)).length;
 const [accountsBefore]=await conn.query("SELECT COUNT(*) AS total FROM operator_accounts");
 const customSignup={email:"custom.code@example.test",password:"Synthetic-Only-Password-2026",name:"Test Operator",businessName:"Custom code business",businessType:"Repair workshop",publicProfile:false,businessCode:me.businessCode};
 assert.equal((await request("/signup",customSignup)).status,400);
 assert.equal((await readdir(env.TRACEFORGE_BUSINESS_WALLET_DIRECTORY)).length,filesBefore);
 const [accountsAfter]=await conn.query("SELECT COUNT(*) AS total FROM operator_accounts");assert.equal(accountsAfter[0].total,accountsBefore[0].total);
 const custom=await request("/signup",{...customSignup,businessCode:" mycode1 "});assert.equal(custom.status,200,JSON.stringify(custom.body));assert.equal(custom.body.businessCode,"MYCODE1");sync();
 checks.push("Custom-code signup rejects an occupied code without leaving an account or key file; a free custom code registers successfully.");
 // Suppress unused fixture warnings while confirming unique root IDs.
 assert.notEqual(duplicate.trackingId,sameBusiness.trackingId);
}

async function concurrentCodes(conn,env,actors,checks){
 const {reserveBusinessCode,backfillBusinessCodes}=await loadSourceFile("src/business-codes.ts");
 const [producer,distributor]=actors;
 const options={host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),user:env.MYSQL_USER,password:env.MYSQL_PASSWORD,database:env.MYSQL_DATABASE};
 const connections=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
 const pool=mysql.createPool(options);
 const [old]=await conn.query("SELECT code,organization_id FROM business_code_reservations WHERE organization_id IN (?,?)",[producer.user.organizationId,distributor.user.organizationId]);
 const [sequence]=await conn.query("SELECT code_length,CAST(ordinal AS CHAR) AS ordinal FROM business_code_sequence WHERE sequence_id=1");
 try{
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id IN (?,?)",[producer.user.organizationId,distributor.user.organizationId]);
  const allocated=await Promise.all(connections.map(async(c,index)=>{await c.beginTransaction();const code=await reserveBusinessCode(c,actors[index].user.organizationId);await c.commit();return code;}));
  assert.equal(new Set(allocated).size,2);
  const same=await Promise.all(connections.map(async c=>{await c.beginTransaction();const code=await reserveBusinessCode(c,producer.user.organizationId);await c.commit();return code;}));
  assert.equal(same[0],same[1]);
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id=?",[distributor.user.organizationId]);
  await backfillBusinessCodes(pool);
  const [backfilled]=await conn.query("SELECT code FROM business_code_reservations WHERE organization_id=?",[distributor.user.organizationId]);
  assert.equal(backfilled.length,1);
  await backfillBusinessCodes(pool);
  const [again]=await conn.query("SELECT code FROM business_code_reservations WHERE organization_id=?",[distributor.user.organizationId]);
  assert.equal(again[0].code,backfilled[0].code);
  const [preserved]=await conn.query("SELECT code FROM business_code_reservations WHERE organization_id=?",[producer.user.organizationId]);
  assert.equal(preserved[0].code,same[0]);
 }finally{
  await pool.end();
  await Promise.all(connections.map(c=>c.end()));
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id IN (?,?)",[producer.user.organizationId,distributor.user.organizationId]);
  for(const row of old)await conn.query("INSERT INTO business_code_reservations(code,organization_id) VALUES(?,?)",[row.code,row.organization_id]);
  await conn.query("UPDATE business_code_sequence SET code_length=?,ordinal=? WHERE sequence_id=1",[sequence[0].code_length,sequence[0].ordinal]);
 }
 checks.push("Concurrent transactions allocate different automatic business codes and serialize retries for the same business.");
}

async function allocatorChecks(conn,actors,checks){
 const {reserveBusinessCode}=await loadSourceFile("src/business-codes.ts");
 const org=actors[3].user.organizationId;
 await conn.beginTransaction();
 try{
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id=?",[org]);
  await conn.query("UPDATE business_code_sequence SET code_length=1,ordinal=35");
  assert.equal(await reserveBusinessCode(conn,org),"9");
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id=?",[org]);
  assert.equal(await reserveBusinessCode(conn,org),"AA");
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id=?",[org]);
  await conn.query("UPDATE business_code_sequence SET code_length=2,ordinal=1295");
  assert.equal(await reserveBusinessCode(conn,org),"99");
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id=?",[org]);
  assert.equal(await reserveBusinessCode(conn,org),"AAA");
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id=?",[org]);
  assert.equal(await reserveBusinessCode(conn,org," mine1 "),"MINE1");
  assert.equal(await reserveBusinessCode(conn,org),"MINE1");
  await assert.rejects(()=>reserveBusinessCode(conn,org,"DIFFERENT"));
  await conn.query("DELETE FROM business_code_reservations WHERE organization_id=?",[org]);
  const [codes]=await conn.query("SELECT code FROM business_code_reservations LIMIT 1");
  await assert.rejects(()=>reserveBusinessCode(conn,org,codes[0].code));
 }finally{await conn.rollback();}
 const [restored]=await conn.query("SELECT code FROM business_code_reservations WHERE organization_id=?",[org]);assert.ok(restored.length);
 checks.push("Business-code reservations support custom values, reject conflicts, reuse existing reservations, roll back safely and grow from one character to two, then three.");
}
