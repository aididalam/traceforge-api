// Shared live checks. No credentials or signed transactions are returned in evidence.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import mysql from "mysql2/promise";
import {createPublicClient,http,keccak256,stringToHex,decodeEventLog} from "viem";
import "dotenv/config";

export async function liveBatchContext(){
 const root=resolve(".."),base=process.env.API_BASE_URL??"http://127.0.0.1:3000";
 assert.ok(["127.0.0.1","localhost"].includes(new URL(base).hostname));
 const deployment=JSON.parse(await readFile(resolve(root,"contracts/deployments/9009/TraceForge.json"),"utf8"));
 const abi=JSON.parse(await readFile(resolve(root,"contracts/artifacts/contracts/TraceForge.sol/TraceForge.json"),"utf8")).abi;
 const address=deployment.contract.address.toLowerCase(),client=createPublicClient({transport:http(process.env.TRACEFORGE_RPC_URL)});
 assert.equal(await client.getChainId(),9009);assert.equal(address,process.env.TRACEFORGE_CONTRACT_ADDRESS?.toLowerCase());
 assert.equal(keccak256(await client.getBytecode({address})),deployment.artifact.expectedRuntimeHash);
 const read=(functionName,args)=>client.readContract({address,abi,functionName,args});
 assert.equal(await read("MAX_PRODUCT_QUANTITY",[]),9007199254740991n);
 const db=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,
  database:process.env.MYSQL_DATABASE,supportBigNumbers:true,bigNumberStrings:true,charset:"utf8mb4"});
 const request=async(path,payload,token)=>{
  for(let attempt=0;attempt<4;attempt++){
   const response=await fetch(base+path,{method:payload?"POST":"GET",headers:{...(payload?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
   if(response.status===429){await new Promise(done=>setTimeout(done,Math.min(60,Number(response.headers.get("retry-after")??60))*1000+100));continue;}
   const body=await response.json();return {status:response.status,body};
  }throw Error("Live request exhausted Retry-After attempts.");
 };
 const call=async(path,payload,token)=>{const result=await request("/operator/v1"+path,payload,token);assert.ok([200,202].includes(result.status),`Live ${path}: HTTP ${result.status}, ${result.body.error?.code??"unknown"}`);return result.body;};
 const approve=async(pending,actors)=>{
  assert.equal(pending.status,'WAITING_APPROVAL');
  const [rows]=await db.query('SELECT source_organization_id FROM receipt_requests WHERE request_id=?',[pending.receiptRequestId]);
  const owner=actors.find(a=>a.user.organizationId===rows[0]?.source_organization_id);assert.ok(owner,'Source owner is required');
  const decisions=await call('/receipt-requests/decisions',{requestIds:[pending.receiptRequestId],action:'approve',idempotencyKey:'live-approve-'+pending.receiptRequestId},owner.token);
  assert.equal(decisions.results[0].ok,true,JSON.stringify(decisions));
  for(let attempt=0;attempt<180;attempt++){
   const [current]=await db.query('SELECT status,result_json FROM receipt_requests WHERE request_id=?',[pending.receiptRequestId]);
   if(current[0].status==='CONFIRMED')return {...pending,...(typeof current[0].result_json==='string'?JSON.parse(current[0].result_json):current[0].result_json),status:'CONFIRMED'};
   assert.equal(current[0].status,'APPROVING',JSON.stringify(current[0]));
   await new Promise(done=>setTimeout(done,1000));
  }throw Error('Owner-approved receipt did not confirm; check the ERP worker.');
 };
 const sync=async()=>{
  const before=await client.getBlockNumber({cacheTime:0});let next=false;
  for(let attempt=0;attempt<80;attempt++){if(await client.getBlockNumber({cacheTime:0})>before){next=true;break;}await new Promise(done=>setTimeout(done,250));}
  assert.ok(next,"Pi stopped producing blocks");
  for(const [folder,file] of [["indexer","dist/backfill.js"],["indexer","dist/project.js"],["api","dist/sync-business-publications.js"]]){
   const result=spawnSync(process.execPath,[file],{cwd:resolve(root,folder),env:process.env,encoding:"utf8",timeout:30000});
   if(result.status!==0)throw Error("Live projection failed: "+folder+"/"+file);
  }
 };
 const prove=async(product,expected={})=>{
  const tenant=product.tenantId,id=product.trackingId,scope=[9009,address,tenant,id];
  const chain=await read("getProduct",[tenant,id]);
  const [quantities]=await db.query("SELECT * FROM product_quantities WHERE chain_id=? AND contract_address=? AND tenant_id=? AND entity_id=?",scope);assert.equal(quantities.length,1);
  for(const [sql,onchain] of [["initial_quantity","initialQuantity"],["available_quantity","availableQuantity"],["removed_quantity","removedQuantity"]])assert.equal(String(quantities[0][sql]),chain[onchain].toString());
  assert.equal(chain.availableQuantity+chain.removedQuantity,chain.initialQuantity);
  if(expected.available!==undefined)assert.equal(chain.availableQuantity.toString(),String(expected.available));
  const entity=await read("getEntity",[tenant,id]);assert.equal(entity.closed,chain.availableQuantity===0n);
  const [documents]=await db.query("SELECT raw_text FROM offchain_documents WHERE content_hash=?",[chain.registrationMetadataHash]);assert.equal(documents.length,1);
  const raw=documents[0].raw_text,metadata=JSON.parse(raw);assert.equal(keccak256(stringToHex(raw)),chain.registrationMetadataHash);
  assert.equal(metadata.id,product.externalId);assert.equal(String(metadata.quantity),chain.initialQuantity.toString());
  if(product.registrationMetadataHash)assert.equal(chain.registrationMetadataHash,product.registrationMetadataHash);
  const [routes]=await db.query("SELECT * FROM batch_routes WHERE chain_id=? AND contract_address=? AND tenant_id=? AND entity_id=? ORDER BY created_event_id",scope);
  let sum=0n;const owned={};
  for(const row of routes){
   const r=await read("getBatchRoute",[tenant,id,row.route_id]);
   for(const [sql,onchain] of [["available_quantity","availableQuantity"],["received_quantity","receivedQuantity"],["forwarded_quantity","forwardedQuantity"],["removed_quantity","removedQuantity"],["version","version"]])assert.equal(String(row[sql]),r[onchain].toString());
   assert.equal(r.organizationId,row.organization_id);assert.equal(r.parentRouteId,row.parent_route_id);
   assert.equal(r.receivedQuantity,r.availableQuantity+r.forwardedQuantity+r.removedQuantity);sum+=r.availableQuantity;
   owned[r.organizationId]=(BigInt(owned[r.organizationId]??"0")+r.availableQuantity).toString();
  }
  if(chain.initialQuantity>1n)assert.equal(sum,chain.availableQuantity);
  if(expected.owned)for(const [org,count] of Object.entries(expected.owned))assert.equal(owned[org]??"0",String(count));
  const [movements]=await db.query("SELECT * FROM quantity_movements WHERE chain_id=? AND contract_address=? AND tenant_id=? AND entity_id=? AND action='REMOVED' ORDER BY chain_event_id",scope);
  assert.equal(movements.reduce((n,m)=>n+BigInt(m.quantity),0n),chain.removedQuantity);
  const totals={};for(let reason=0;reason<6;reason++){const total=movements.filter(m=>Number(m.reason)===reason).reduce((n,m)=>n+BigInt(m.quantity),0n);assert.equal(await read("getRemovalTotal",[tenant,id,reason]),total);totals[["Sold","Lost","Damaged","Spoiled","Disposed","Other"][reason]]=total.toString();}
  for(const m of movements){
   const receipt=await client.getTransactionReceipt({hash:m.transaction_hash});assert.equal(receipt.status,"success");
   const events=receipt.logs.filter(log=>log.address.toLowerCase()===address).flatMap(log=>{try{return [decodeEventLog({abi,topics:log.topics,data:log.data})];}catch{return [];}});
   const event=events.find(e=>e.eventName==="QuantityRemoved");assert.ok(event);assert.equal(event.args.quantity.toString(),String(m.quantity));assert.equal(event.args.reasonText,m.reason_text);assert.equal(Number(event.args.reason),Number(m.reason));
  }
  const [aliases]=await db.query("SELECT short_code FROM public_entity_short_links WHERE tracking_id=UNHEX(SUBSTRING(?,3))",[id]);assert.equal(aliases.length,1);assert.equal(aliases[0].short_code,product.shortCode);
  return {trackingId:id,name:metadata.name,externalId:metadata.id,shortCode:product.shortCode,initialQuantity:chain.initialQuantity.toString(),availableQuantity:chain.availableQuantity.toString(),removedQuantity:chain.removedQuantity.toString(),isBatch:chain.initialQuantity>1n,closed:entity.closed,rootRouteId:chain.rootRouteId,registrationMetadataHash:chain.registrationMetadataHash,routes:routes.length,removals:movements.length,owned,reasons:totals};
 };
 return {root,base,address,deployment,abi,client,db,read,request,call,sync,prove,approve};
}
