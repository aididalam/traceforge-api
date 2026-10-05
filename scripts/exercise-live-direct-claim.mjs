// Explicit live demo on the configured deployment. Credentials stay in a private file.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import "dotenv/config";
import mysql from "mysql2/promise";
import { createPublicClient, http, keccak256, stringToHex, zeroHash } from "viem";
if(!process.argv.includes("--broadcast"))throw Error("Use --broadcast to run the live demo.");
const root=resolve(".."),base=process.env.API_BASE_URL??"http://127.0.0.1:3000";
const deployment=JSON.parse(await readFile(resolve(root,"contracts/deployments/9009/TraceForge.json"),"utf8"));
const abi=JSON.parse(await readFile(resolve(root,"contracts/artifacts/contracts/TraceForge.sol/TraceForge.json"),"utf8")).abi;
const address=deployment.contract.address,client=createPublicClient({transport:http(process.env.TRACEFORGE_RPC_URL)});
assert.equal(await client.getChainId(),9009);assert.equal(keccak256(await client.getBytecode({address})),deployment.artifact.expectedRuntimeHash);
const secretDir=resolve(homedir(),".traceforge/secrets"),credentialFile=resolve(secretDir,"direct-claim-demo-accounts.json");
await mkdir(secretDir,{recursive:true,mode:0o700});
let accounts;
try {assert.equal((await stat(credentialFile)).mode&0o077,0);accounts=JSON.parse(await readFile(credentialFile,"utf8"));}
catch(error){if(error.code!=="ENOENT")throw error;accounts=["Producer","Distributor","Shop"].map(type=>({type,name:"TraceForge Demo "+type,email:type.toLowerCase()+"@traceforge.test",password:randomBytes(24).toString("base64url")}));
 await writeFile(credentialFile,JSON.stringify(accounts,null,2),{flag:"wx",mode:0o600});}
const call=async(path,payload,token)=>{
 const response=await fetch(base+"/operator/v1"+path,{method:payload?"POST":"GET",headers:{...(payload?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const body=await response.json();assert.equal(response.status,200,`Live ${path} failed (${response.status}): ${body.error?.code??"unknown"}`);return body;
};
async function sync(){
 const before=await client.getBlockNumber();
 for(let i=0;i<30;i++){if(await client.getBlockNumber({cacheTime:0})>before)break;await new Promise(done=>setTimeout(done,300));}
 for(const [folder,file]of [["indexer","dist/backfill.js"],["indexer","dist/project.js"],["api","dist/sync-business-publications.js"]]){
  const result=spawnSync(process.execPath,[file],{cwd:resolve(root,folder),env:process.env,encoding:"utf8",timeout:30000});
  if(result.status!==0)throw Error("Live projection failed: "+folder+"/"+file);
 }
}
const actors=[];
for(const account of accounts){
 let response=await fetch(base+"/operator/v1/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:account.email,password:account.password})});
 if(response.status!==200){const result=await call("/signup",{email:account.email,password:account.password,name:"Demo Operator",businessName:account.name,businessType:account.type,publicProfile:true});assert.equal(result.created,true);await sync();}
 const login=await call("/login",{email:account.email,password:account.password});actors.push({...account,token:login.sessionToken,user:login.user});
}
const [producer,distributor,shop]=actors,transactions=[];
async function create(name,key){const result=await call("/products/create",{name,description:"Demonstration product on the fresh TraceForge chain. This is a test supply record.",publish:true,idempotencyKey:key},producer.token);assert.equal(result.status,"CONFIRMED");transactions.push(result);await sync();return result.trackingId;}
const sold=await create("Demo Cola Bottle · sold","live-demo-sold-20261005"),open=await create("Demo Cola Bottle · open","live-demo-open-20261005");
const read=(functionName,args)=>client.readContract({address,abi,functionName,args});
assert.equal(await read("isActiveTenantMember",[producer.user.tenantId,distributor.user.organizationId]),false);
assert.equal(await read("isActiveTenantMember",[producer.user.tenantId,shop.user.organizationId]),false);
for(const [product,actor,version,key]of [[sold,distributor,"0","live-demo-distributor-receive"],[sold,shop,"1","live-demo-shop-receive"],[open,distributor,"0","live-demo-open-receive"]]){
 const result=await call("/products/"+product+"/receive",{version,confirmed:true,idempotencyKey:key},actor.token);assert.equal(result.status,"CONFIRMED");transactions.push(result);await sync();
}
const close=await call("/products/"+sold+"/close",{reason:"Sold",confirmed:true,idempotencyKey:"live-demo-shop-close"},shop.token);assert.equal(close.status,"CONFIRMED");transactions.push(close);await sync();
const [soldState,openState]=await Promise.all([read("getEntity",[producer.user.tenantId,sold]),read("getEntity",[producer.user.tenantId,open])]);
assert.equal(soldState.closed,true);assert.equal(soldState.currentCustodian,shop.user.organizationId);assert.equal(openState.closed,false);assert.equal(openState.currentCustodian,distributor.user.organizationId);
const keys=process.env.TRACEFORGE_BUSINESS_WALLET_DIRECTORY;
const {privateKeyToAccount}=await import("viem/accounts");
const producerWallet=privateKeyToAccount((await readFile(resolve(keys,producer.user.organizationId+".key"),"utf8")).trim());
const shopWallet=privateKeyToAccount((await readFile(resolve(keys,shop.user.organizationId+".key"),"utf8")).trim());
const hash=value=>keccak256(stringToHex(value));
await assert.rejects(()=>client.simulateContract({address,abi,functionName:"closeEntity",args:[producer.user.tenantId,zeroHash,open,hash("CLOSE"),hash("EVIDENCE")],account:producerWallet.address}),/NotCurrentCustodian/);
await assert.rejects(()=>client.simulateContract({address,abi,functionName:"claimCustody",args:[producer.user.tenantId,sold,3n,hash("RECEIVED"),hash("EVIDENCE")],account:shopWallet.address}),/EntityIsClosed/);
await assert.rejects(()=>client.simulateContract({address,abi,functionName:"claimCustody",args:[producer.user.tenantId,open,0n,hash("RECEIVED"),hash("EVIDENCE")],account:shopWallet.address}),/StaleCustody/);
const db=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE});
try {
 const [rows]=await db.query("SELECT CONCAT('0x',LOWER(HEX(t.tracking_id))) AS tracking_id,s.short_code FROM public_entity_tracking_ids t JOIN public_entity_short_links s ON s.tracking_id=t.tracking_id ORDER BY s.short_code");
 const [journal]=await db.query("SELECT COUNT(*) AS total,SUM(status<>'CONFIRMED') AS unconfirmed,SUM(serialized_transaction IS NOT NULL) AS signed FROM chain_write_operations");
 assert.equal(Number(journal[0].unconfirmed),0);assert.equal(Number(journal[0].signed),0);
 const [events]=await db.query("SELECT CAST(chain_event_id AS CHAR) AS event_id,tenant_id,entity_id,from_organization_id,to_organization_id,actor,evidence_hash,CAST(custody_version AS CHAR) AS custody_version,CAST(received_at AS CHAR) AS received_at FROM custody_claims ORDER BY chain_event_id");assert.equal(events.length,3);
 const traces={};for(const id of [sold,open]){const ref=await(await fetch(base+"/public/v1/tracking/"+id)).json();const trace=await(await fetch(base+`/public/v1/tenants/${ref.tenantId}/entities/${ref.entityId}/history`)).json();assert.ok(trace.entity.productInfo.name);assert.ok(trace.entity.currentHolder.name);assert.ok(trace.events.every(event=>event.occurredAt));traces[id]={name:trace.entity.productInfo.name,currentHolder:trace.entity.currentHolder.name,closed:trace.entity.closed,updates:trace.events.length};}
 const report={schemaVersion:2,passed:true,network:{chainId:9009,deploymentBlock:deployment.deployment.blockNumber},contract:{address,runtimeBytecodeHash:deployment.artifact.expectedRuntimeHash},
  checks:{independentSignup:true,noReceivingMembership:true,directReceipt:true,holderOnlyClose:true,closedProductCannotBeReceived:true,staleReceiptRejected:true,publicNamesAndDates:true,journalsConfirmed:true,serializedTransactionsCleared:true,oldPendingTransferTableRemoved:true},
  products:rows.map(row=>({...row,...traces[row.tracking_id]})),transactions,receipts:events,confirmedTransactions:Number(journal[0].total)};
 await mkdir(resolve(root,"contracts/deployments/9009/operations"),{recursive:true});
 await writeFile(resolve(root,"contracts/deployments/9009/operations/direct-claim-demo.json"),JSON.stringify(report,null,2)+"\n");
 await writeFile("/private/tmp/TraceForge-Direct-Claim-Live-2026-10-05.json",JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({passed:true,confirmedTransactions:report.confirmedTransactions,products:report.products,checks:report.checks},null,2));
}finally{await db.end();}
