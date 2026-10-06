// Test-only orchestration. No routes or switches are added to the production API.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {randomUUID,randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {writeFile,rm} from "node:fs/promises";
import {resolve,join} from "node:path";
import {keccak256,stringToHex} from "viem";

export async function browserIntegrationChecks(h){
 const {request,read,sync,conn,api,actors,invoke,env,indexerDist,checks,root,walletDir,fetcher}=h;
 assert.match(env.MYSQL_DATABASE,/^traceforge_test_claim_[a-f0-9]{32}$/);
 assert.equal(env.TRACEFORGE_RPC_URL,"http://127.0.0.1:18545");assert.equal(api,"http://127.0.0.1:13301");
 const [producer]=actors,secret=randomBytes(32).toString("hex"),manifest=join(walletDir,"browser-fixture.json");
 console.log("Preparing real browser acceptance and BIGINT pagination records.");
 let next,browser;const checkpoints=[],identities=new Map();
 // Actual BIGINT event cursors above JS's exact integer range (not fabricated JSON).
 await conn.query("ALTER TABLE chain_events AUTO_INCREMENT=9007199254741000");
 const create=async(name,publish,quantity)=>{
  const result=await request("/products/create",{name,id:name,quantity,publish,fields:[{label:publish?"Description":"Private note",value:publish?"Synthetic pagination acceptance batch":"PRIVATE_BROWSER_SENTINEL"}],idempotencyKey:randomUUID()},producer.token);
  assert.equal(result.status,200);assert.equal(result.body.status,"CONFIRMED");sync();return result.body;
 };
 const privateProduct=await create("Private browser product",false,100);
 const paginated=await create("Paginated browser batch",true,70);
 const original=await read("getProduct",[producer.user.tenantId,paginated.trackingId]);
 for(let version=0;version<55;version++){
  const result=await request(`/products/${paginated.trackingId}/remove`,{routeId:original.rootRouteId,quantity:1,version:String(version),reason:"Sold",confirmed:true,idempotencyKey:randomUUID()},producer.token);
  assert.equal(result.status,200);assert.equal(result.body.status,"CONFIRMED");
 }
 sync();
 const snapshot=async()=>{
  const result={};for(const [table,order] of [["product_quantities","entity_id"],["batch_routes","entity_id,route_id"],["quantity_movements","chain_event_id"],["custody_claims","chain_event_id"],["entities","tenant_id,entity_id"]])
   result[table]=(await conn.query(`SELECT * FROM ${table} ORDER BY ${order}`))[0];
  return JSON.stringify(result);
 };
 const checkpoint=async(body)=>{
  sync();const {trackingId,available,removed}=body;
  const [rows]=await conn.query("SELECT * FROM product_quantities WHERE entity_id=? AND chain_id=? AND contract_address=?",[trackingId,9009,env.TRACEFORGE_CONTRACT_ADDRESS.toLowerCase()]);
  assert.equal(rows.length,1);const row=rows[0],product=await read("getProduct",[row.tenant_id,trackingId]);
  for(const [sql,onchain] of [["initial_quantity","initialQuantity"],["available_quantity","availableQuantity"],["removed_quantity","removedQuantity"]])assert.equal(String(row[sql]),product[onchain].toString());
  assert.equal(product.availableQuantity+product.removedQuantity,product.initialQuantity);
  if(available!==undefined)assert.equal(product.availableQuantity.toString(),String(available));
  if(removed!==undefined)assert.equal(product.removedQuantity.toString(),String(removed));
  const [documents]=await conn.query("SELECT raw_text FROM offchain_documents WHERE content_hash=?",[product.registrationMetadataHash]);
  assert.equal(documents.length,1);assert.equal(keccak256(stringToHex(documents[0].raw_text)),product.registrationMetadataHash);
  const document=JSON.parse(documents[0].raw_text);
  assert.equal(String(document.quantity),product.initialQuantity.toString());
  const identity={hash:product.registrationMetadataHash,id:document.id,initial:product.initialQuantity.toString(),root:product.rootRouteId};
  if(identities.has(trackingId))assert.deepEqual(identity,identities.get(trackingId));else identities.set(trackingId,identity);
  const [routes]=await conn.query("SELECT * FROM batch_routes WHERE entity_id=? ORDER BY created_event_id",[trackingId]);
  let sum=0n;const owned={};
  for(const r of routes){
   const route=await read("getBatchRoute",[row.tenant_id,trackingId,r.route_id]);
   for(const [sql,onchain] of [["received_quantity","receivedQuantity"],["available_quantity","availableQuantity"],["forwarded_quantity","forwardedQuantity"],["removed_quantity","removedQuantity"],["version","version"]])assert.equal(String(r[sql]),route[onchain].toString());
   assert.equal(route.organizationId,r.organization_id);assert.equal(route.parentRouteId,r.parent_route_id);
   assert.equal(route.receivedQuantity,route.availableQuantity+route.forwardedQuantity+route.removedQuantity);
   sum+=route.availableQuantity;owned[r.organization_id]=(BigInt(owned[r.organization_id]??"0")+route.availableQuantity).toString();
  }
  if(product.initialQuantity>1n)assert.equal(sum,product.availableQuantity);
  const [movements]=await conn.query("SELECT * FROM quantity_movements WHERE entity_id=? AND action='REMOVED' ORDER BY chain_event_id",[trackingId]);
  assert.equal(movements.reduce((total,m)=>total+BigInt(m.quantity),0n),product.removedQuantity);
  for(let reason=0;reason<6;reason++)assert.equal(await read("getRemovalTotal",[row.tenant_id,trackingId,reason]),movements.filter(m=>Number(m.reason)===reason).reduce((total,m)=>total+BigInt(m.quantity),0n));
  const history=await request(`/products/${trackingId}/history`,undefined,producer.token);assert.equal(history.status,200);
  const summary=history.body.product.quantity;
  assert.equal(summary.availableQuantity,product.availableQuantity.toString());
  if(body.owned)for(const [actorIndex,count] of Object.entries(body.owned))assert.equal(owned[actors[Number(actorIndex)].user.organizationId]??"0",String(count));
  if(body.reasons)for(const [reason,count] of Object.entries(body.reasons))assert.equal(summary.reasons.find(r=>r.reason===reason)?.quantity,String(count));
  const proof={trackingId,initial:product.initialQuantity.toString(),available:product.availableQuantity.toString(),removed:product.removedQuantity.toString(),routes:routes.length,removalRecords:movements.length};
  checkpoints.push(proof);console.log("Browser checkpoint "+JSON.stringify(proof));
  return {...proof,rootRouteId:product.rootRouteId,hash:product.registrationMetadataHash,routes:routes.map(r=>({id:r.route_id,owner:r.organization_id,available:String(r.available_quantity),parent:r.parent_route_id}))};
 };
 const server=createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json");
  if(req.headers["x-test-control"]!==secret||req.method!=="POST"){res.writeHead(403).end('{}');return;}
  try{
   let raw="";for await(const part of req){raw+=part;if(raw.length>4096)throw Error("Oversized test command");}
   const body=JSON.parse(raw);let result;
   if(req.url==="/checkpoint")result=await checkpoint(body);
   else if(req.url==="/rebuild"){
    sync();const before=await snapshot();invoke("indexer",indexerDist+"/project.js",env);assert.equal(await snapshot(),before);
    invoke("indexer",indexerDist+"/project.js",env,["--rebuild"]);assert.equal(await snapshot(),before);result={equal:true,tables:5};
   }else throw Error("Unknown test command");
   res.end(JSON.stringify(result));
  }catch(error){console.error("Browser test control failed: "+error.message);res.writeHead(500).end(JSON.stringify({error:error.message}));}
 });
 await new Promise(done=>server.listen(0,"127.0.0.1",done));
 try{
  await writeFile(manifest,JSON.stringify({controlOrigin:`http://127.0.0.1:${server.address().port}`,controlSecret:secret,actors:actors.map(a=>({name:a.name,email:a.email,organizationId:a.user.organizationId})),privateProduct,paginated}),{mode:0o600});
  const uiEnv={...process.env,NEXT_TELEMETRY_DISABLED:"1",TRACEFORGE_PUBLIC_API_ORIGIN:api,TRACEFORGE_OPERATOR_API_ORIGIN:api,TRACEFORGE_OPERATOR_SITE_ORIGIN:"http://127.0.0.1:13478",TRACEFORGE_INTEGRATION_MANIFEST:manifest};
  // Do not pass MySQL credentials, signing configuration or server tokens to the UI.
  for(const key of Object.keys(uiEnv))if(/^(MYSQL_|TRACEFORGE_SIGNER_|TRACEFORGE_BUSINESS_WALLET)/.test(key))delete uiEnv[key];
  next=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","13478"],{cwd:resolve(root,"ui"),env:uiEnv,stdio:["ignore","ignore","pipe"]});
  let errors="";next.stderr.on("data",chunk=>{errors=(errors+chunk).slice(-2000);});
  let ready=false;for(let i=0;i<100;i++){if(next.exitCode!==null)throw Error("Owned integration UI failed to start: "+errors);try{if((await fetch("http://127.0.0.1:13478")).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,100));}assert.ok(ready);
  browser=spawn(process.execPath,["node_modules/@playwright/test/cli.js","test","--config","playwright.integration.config.ts"],{cwd:resolve(root,"ui"),env:uiEnv,stdio:"inherit"});
  assert.equal(await new Promise(done=>browser.once("exit",done)),0,"Real browser integration failed");
  await checkpoint({trackingId:paginated.trackingId,available:"15",removed:"55"});
  const privateResponse=await fetcher(api+"/public/v1/tracking/"+privateProduct.trackingId);assert.equal(privateResponse.status,404);
  checks.push("Unmocked desktop/mobile browsers create singles and million-item batches, resolve duplicate business IDs, receive exact routes, return stock, record bulk sold/lost/spoiled reasons and exhaust the final item; every mutation matches contract and SQL balances.");
  checks.push("Real MySQL event IDs above 2^53 survive API and browser history pagination beyond 50 updates; full quantity, route, movement, custody and entity rebuilds equal their original projections.");
  return {profiles:2,checkpoints:checkpoints.length,paginatedRemovals:55,eventCursorStartsAt:"9007199254741000",replayTables:5,proofs:checkpoints};
 }finally{
  for(const child of [browser,next])if(child&&child.exitCode===null)await new Promise(done=>{child.once("exit",done);child.kill("SIGTERM");});
  await new Promise(done=>server.close(done));await rm(manifest,{force:true});
 }
}
