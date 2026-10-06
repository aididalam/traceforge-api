// A disposable MySQL database and local Hardhat chain. Never points at Pi.
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, stringToHex } from "viem";

const root=resolve(".."),rpc="http://127.0.0.1:18545",api="http://127.0.0.1:13301";
const local={...process.env,...dotenv.parse(await readFile(".env","utf8").catch(error=>{if(error.code!=="ENOENT")throw error;return "";}))};
const database="traceforge_test_claim_"+randomUUID().replaceAll("-","");
const walletDir=await mkdtemp(join(tmpdir(),"traceforge-claim-wallets-"));
const admin=await mysql.createConnection({host:local.MYSQL_HOST,port:Number(local.MYSQL_PORT),user:local.MYSQL_USER,password:local.MYSQL_PASSWORD,multipleStatements:true});
const chain=defineChain({id:9009,name:"Isolated TraceForge integration",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[rpc]}}});
const client=createPublicClient({chain,transport:http(rpc)}),checks=[];
let child,conn;
const invoke=(folder,file,env)=>{
 const result=spawnSync(process.execPath,[file],{cwd:resolve(root,folder),env,encoding:"utf8",timeout:30000});
 if(result.status!==0)throw Error(`Isolated ${folder}/${file} failed: ${result.stderr.split("\n").filter(line=>!line.includes("data:text")).slice(-8).join("\n")}`);
};
try {
 assert.equal(await client.getChainId(),9009);
 assert.equal(new URL(rpc).port,"18545");
 const artifact=JSON.parse(await readFile(resolve(root,"contracts/artifacts/contracts/TraceForge.sol/TraceForge.json"),"utf8"));
 const accounts=await client.request({method:"eth_accounts"});
 const wallet=createWalletClient({account:accounts[0],chain,transport:http(rpc)});
 const tx=await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode,gasPrice:0n});
 const deployment=await client.waitForTransactionReceipt({hash:tx}),address=deployment.contractAddress;
 assert.ok(address);assert.equal(deployment.status,"success");
 await admin.query("CREATE DATABASE `"+database+"`");
 conn=await mysql.createConnection({host:local.MYSQL_HOST,port:Number(local.MYSQL_PORT),user:local.MYSQL_USER,password:local.MYSQL_PASSWORD,database,multipleStatements:true});
 for(const folder of ["indexer","api"]){for(const filename of (await readdir(resolve(root,folder,"migrations"))).filter(file=>file.endsWith(".sql")).sort())await conn.query(await readFile(resolve(root,folder,"migrations",filename),"utf8"));}
 const env={...process.env,...local,MYSQL_DATABASE:database,TRACEFORGE_CHAIN_ID:"9009",TRACEFORGE_RPC_URL:rpc,TRACEFORGE_CONTRACT_ADDRESS:address,
  TRACEFORGE_DEPLOYMENT_BLOCK:deployment.blockNumber.toString(),TRACEFORGE_RUNTIME_BYTECODE_HASH:keccak256(await client.getBytecode({address})),
  TRACEFORGE_BROADCAST_ENABLED:"true",TRACEFORGE_BUSINESS_WALLET_DIRECTORY:walletDir,INDEXER_CONFIRMATIONS:"0",API_PORT:"13301",API_HOST:"127.0.0.1"};
 delete env.TRACEFORGE_SIGNER_MAP_FILE;delete env.TRACEFORGE_SIGNER_KEY_FILE;delete env.TRACEFORGE_SIGNER_ADDRESS;
 let stderr="";
 child=spawn(process.execPath,["dist/server.js"],{cwd:resolve(root,"api"),env,stdio:["ignore","ignore","pipe"]});
 child.stderr.on("data",chunk=>stderr+=chunk);
 for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error("Isolated API failed to start: "+stderr.slice(-1500));try{if((await fetch(api+"/health")).ok)break;}catch{}await new Promise(done=>setTimeout(done,100));}
 const sync=()=>{invoke("indexer","dist/backfill.js",env);invoke("indexer","dist/project.js",env);invoke("api","dist/sync-business-publications.js",env);};
 const request=async(path,payload,token)=>{const response=await fetch(api+"/operator/v1"+path,{method:payload?"POST":"GET",headers:{...(payload?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},...(payload?{body:JSON.stringify(payload)}:{})});return {status:response.status,body:await response.json()};};
 const password="Synthetic-Only-Password-2026";
 const actors=[];
 for(const [name,type] of [["Test Producer","Producer"],["Test Distributor","Distributor"],["Test Shop","Shop"],["Other Producer","Producer"]]){
  const email=name.toLowerCase().replaceAll(" ",".")+"@example.test";
  const signup=await request("/signup",{email,password,name:"Test Operator",businessName:name,businessType:type,publicProfile:true});
  assert.equal(signup.status,200,JSON.stringify(signup.body));assert.equal(signup.body.created,true);sync();
  const login=await request("/login",{email,password});assert.equal(login.status,200,JSON.stringify(login.body));
  actors.push({name,email,token:login.body.sessionToken,user:login.body.user});
 }
 const [producer,distributor,shop,other]=actors;
 const genericToken=async(actor,tenantId)=>{
  const token="Synthetic-Integration-"+randomUUID();
  await conn.query("INSERT INTO api_auth_tokens (token_id,token_hash,token_hint,tenant_id,organization_id,token_name,scopes) VALUES (?,?,?,?,?,?,?)",
   [randomUUID(),createHash("sha256").update(token).digest("hex"),"synthetic-only",tenantId,actor.user.organizationId,"isolated-integration",JSON.stringify(["tenant:read","chain:write"])]);
  return token;
 };
 const generic=async(tenantId,trackingId,path,body,token)=>{
  const response=await fetch(`${api}/v1/tenants/${tenantId}/entities/${trackingId}/${path}`,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json","Idempotency-Key":"integration-"+randomUUID()},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
 checks.push("Four independent businesses signed up, registered on chain and signed in without invitations.");
 const fields=[{label:"Batch number",value:"BATCH-2026-001"},{label:"Ingredients",value:"Water, Sugar\nNatural Flavour · 500mL"},{label:"Origin",value:"বাংলাদেশ"},
  ...Array.from({length:5},(_,i)=>({label:"Quality note "+(i+1),value:"Bounded JSON field "+"x".repeat(900)}))];
 const creates=new Map();
 const create=async(actor,name,publish,details,description="TraceForge integration product data")=>{
  const body={name,description,...(details?{fields:details}:{}),publish,idempotencyKey:randomUUID()};
  const result=await request("/products/create",body,actor.token);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.status,"CONFIRMED");
  creates.set(result.body.trackingId,{body,result:result.body});sync();return result.body.trackingId;
 };
 const first=await create(producer,"Integration Bottle",true,fields),second=await create(other,"Other Producer Bottle",true,undefined,""),privateId=await create(other,"PRIVATE_PRODUCT_SENTINEL",false,[{label:"Private supplier note",value:"PRIVATE_FIELD_SENTINEL"}]);
 const invalidCreate={name:"Invalid details",description:"",publish:false,idempotencyKey:randomUUID()};
 const [documentsBefore]=await conn.query("SELECT COUNT(*) AS total FROM offchain_documents");
 for(const invalid of [[{label:"Batch",value:"1"},{label:" batch ",value:"2"}],[{label:" ",value:"1"}],[{label:"Batch",value:1}],[{label:"Batch",value:"1",hidden:true}],Array.from({length:33},(_,i)=>({label:"Field "+i,value:"1"}))])
  assert.equal((await request("/products/create",{...invalidCreate,fields:invalid},producer.token)).status,400);
 const [documentsAfter]=await conn.query("SELECT COUNT(*) AS total FROM offchain_documents");assert.equal(Number(documentsAfter[0].total),Number(documentsBefore[0].total));
 assert.equal((await request("/products",undefined,distributor.token)).body.products.length,0);
 const read=(functionName,args)=>client.readContract({address,abi:artifact.abi,functionName,args});
 assert.equal(await read("isActiveTenantMember",[producer.user.tenantId,distributor.user.organizationId]),false);
 const before=await read("getEntity",[producer.user.tenantId,first]);
 const [metadataRows]=await conn.query("SELECT raw_text,document_json FROM offchain_documents WHERE content_hash=?",[before.metadataHash]);
 const saved=typeof metadataRows[0].document_json==="string"?JSON.parse(metadataRows[0].document_json):metadataRows[0].document_json;
 assert.deepEqual(saved.fields,fields);assert.equal(keccak256(stringToHex(metadataRows[0].raw_text)),before.metadataHash);
 const original=creates.get(first),createRetry=await request("/products/create",original.body,producer.token);
 assert.equal(createRetry.status,200);assert.equal(createRetry.body.transactionHash,original.result.transactionHash);
 assert.equal((await request("/products/create",{...original.body,fields:[{...fields[0],value:"Different batch"},...fields.slice(1)]},producer.token)).status,409);
 assert.equal((await read("getEntity",[producer.user.tenantId,first])).metadataHash,before.metadataHash);
 const producerHistory=await request("/products/"+first+"/history",undefined,producer.token);assert.deepEqual(producerHistory.body.product.fields,fields);
 checks.push("Dynamic field labels/values round-trip through stored JSON, operator details and the on-chain metadata hash; invalid or duplicate fields are rejected before storage.");
 const producerWriteToken=await genericToken(producer,producer.user.tenantId),evidenceHash=before.metadataHash,eventType=before.currentState;
 const traceSimulation=await generic(producer.user.tenantId,first,"traces/simulate",{eventType,evidenceHash},producerWriteToken);
 assert.equal(traceSimulation.status,200,JSON.stringify(traceSimulation.body));assert.equal(traceSimulation.body.simulated,true);assert.ok(!("transactionHash" in traceSimulation.body));
 assert.deepEqual(await read("getEntity",[producer.user.tenantId,first]),before);
 const lookup=await request("/receive/"+first,undefined,distributor.token);assert.equal(lookup.status,200);assert.equal(lookup.body.canReceive,true);assert.equal(lookup.body.name,"Integration Bottle");
 assert.deepEqual(await read("getEntity",[producer.user.tenantId,first]),before);
 const receiveBody={version:lookup.body.version,confirmed:true,idempotencyKey:randomUUID()};
 assert.equal((await request("/products/"+first+"/receive",{...receiveBody,confirmed:false},distributor.token)).status,400);
 assert.equal((await request("/products/"+first+"/receive",receiveBody)).status,401);
 const received=await request("/products/"+first+"/receive",receiveBody,distributor.token);assert.equal(received.status,200,JSON.stringify(received.body));assert.equal(received.body.status,"CONFIRMED");sync();
 const retry=await request("/products/"+first+"/receive",receiveBody,distributor.token);assert.equal(retry.status,200);assert.equal(retry.body.transactionHash,received.body.transactionHash);
 assert.equal((await request("/products/"+first+"/receive",{...receiveBody,version:"1"},distributor.token)).status,409);
 assert.equal((await read("getEntity",[producer.user.tenantId,first])).currentCustodian,distributor.user.organizationId);
 assert.equal((await request("/products/"+first+"/receive",{version:"0",confirmed:true,idempotencyKey:randomUUID()},shop.token)).status,409);
 checks.push("Scanning does not transfer; explicit receipt changes holder without membership. Retries are idempotent; stale/conflicting claims are rejected.");
 const secondLookup=await request("/receive/"+second,undefined,distributor.token);
 assert.equal((await request("/products/"+second+"/receive",{version:secondLookup.body.version,confirmed:true,idempotencyKey:randomUUID()},distributor.token)).status,200);sync();
 const inventory=await request("/products",undefined,distributor.token);assert.equal(inventory.body.products.length,2);assert.ok(inventory.body.products.every(p=>p.holder.id===distributor.user.organizationId));
 const outsideWriteToken=await genericToken(distributor,other.user.tenantId);
 const closeSimulation=await generic(other.user.tenantId,second,"close/simulate",{eventType,evidenceHash},outsideWriteToken);
 assert.equal(closeSimulation.status,200,JSON.stringify(closeSimulation.body));assert.equal(closeSimulation.body.simulated,true);
 assert.equal(await read("isActiveTenantMember",[other.user.tenantId,distributor.user.organizationId]),false);
 checks.push("Generic production simulation makes no changes; generic Close simulation authorizes the current holder without producer membership or Shop role.");
 assert.equal((await request("/products/"+privateId+"/history",undefined,distributor.token)).status,404);
 const privateLookup=await request("/receive/"+privateId,undefined,distributor.token);assert.equal(privateLookup.body.name,null);assert.ok(!JSON.stringify(privateLookup).includes("PRIVATE_PRODUCT_SENTINEL"));
 checks.push("One business receives products from two independent producers; inventory spans workspaces while unrelated private metadata stays hidden.");
 const closeBody={reason:"Damaged",confirmed:true,idempotencyKey:randomUUID()};
 assert.equal((await request("/products/"+first+"/close",closeBody,producer.token)).status,409);
 const closed=await request("/products/"+first+"/close",closeBody,distributor.token);assert.equal(closed.status,200,JSON.stringify(closed.body));assert.equal(closed.body.status,"CONFIRMED");sync();
 assert.equal((await read("getEntity",[producer.user.tenantId,first])).closed,true);
 for(const [suffix,body] of [
  ["create",{entityType:before.entityType,metadataHash:before.metadataHash,initialState:eventType}],
  ["traces",{eventType,evidenceHash}],
  ["state",{eventType,evidenceHash,newState:eventType}],
  ["metadata",{eventType,evidenceHash,newMetadataHash:before.metadataHash}],
  ["links",{eventType,evidenceHash,targetEntityId:first,linkType:eventType}],
  ["links/status",{eventType,evidenceHash,targetEntityId:first,linkType:eventType,active:true}],
  ["close",{eventType,evidenceHash}]
 ]){
  const rejected=await generic(producer.user.tenantId,first,suffix+"/simulate",body,producerWriteToken);
  assert.equal(rejected.status,409,JSON.stringify(rejected.body));assert.equal(rejected.body.simulated,false);
 }
 checks.push("All seven generic mutation simulations reject closed products; retired proposal/accept/cancel routes are absent.");
 const openApi=await (await fetch(api+"/openapi.json")).json();assert.ok(!Object.keys(openApi.paths).some(path=>/custody\/(propose|accept|cancel)/.test(path)));
 assert.equal((await request("/products/"+first+"/receive",{version:"2",confirmed:true,idempotencyKey:randomUUID()},shop.token)).status,409);
 const history=await request("/products/"+first+"/history",undefined,distributor.token);assert.equal(history.status,200);assert.equal(history.body.events.filter(e=>e.name==="CustodyClaimed").length,1);assert.ok(history.body.events.every(e=>e.occurredAt!==null));
 checks.push("Distributor closes its current product without Shop role or production membership; non-holder close and receiving a closed product fail.");
 const publicRef=await fetch(api+"/public/v1/tracking/"+first);assert.equal(publicRef.status,200);const ref=await publicRef.json();
 const publicHistory=await (await fetch(api+`/public/v1/tenants/${ref.tenantId}/entities/${ref.entityId}/history`)).json();
 assert.equal(publicHistory.entity.productInfo.name,"Integration Bottle");assert.equal(publicHistory.entity.currentHolder.name,"Test Distributor");assert.ok(publicHistory.events.some(e=>e.eventName==="CustodyClaimed"&&e.occurredAt));
 assert.deepEqual(publicHistory.entity.productInfo.fields,fields);
 const secondRef=await (await fetch(api+"/public/v1/tracking/"+second)).json();
 const secondDetail=await (await fetch(api+`/public/v1/tenants/${secondRef.tenantId}/entities/${secondRef.entityId}`)).json();assert.equal(secondDetail.productInfo.description,null);
 assert.ok(!JSON.stringify(publicHistory).includes("PRIVATE_FIELD_SENTINEL"));
 assert.ok(!JSON.stringify(privateLookup).includes("PRIVATE_FIELD_SENTINEL"));
 const [aliases]=await conn.query("SELECT short_code FROM public_entity_short_links WHERE tracking_id=UNHEX(SUBSTRING(?,3))",[first]);
 assert.equal((await request("/receive/"+aliases[0].short_code,undefined,shop.token)).body.trackingId,first);
 assert.equal((await fetch(api+"/public/v1/tracking/"+privateId)).status,404);
 await conn.query("DELETE FROM public_entity_publications WHERE tenant_id=? AND entity_id=?",[producer.user.tenantId,first]);sync();
 assert.equal((await fetch(api+"/public/v1/tracking/"+first)).status,404);
 assert.equal((await request("/receive/"+first,undefined,shop.token)).body.name,null,"Scan preview exposed an unpublished product name");
 checks.push("Public tracking keeps named holders, product details, dates and short IDs. Private products stay hidden, and sync respects explicit unpublishing.");
 const [journal]=await conn.query("SELECT COUNT(*) AS total,SUM(serialized_transaction IS NOT NULL) AS signed FROM chain_write_operations WHERE status='CONFIRMED'");assert.equal(Number(journal[0].signed),0);
 const [claims]=await conn.query("SELECT COUNT(*) AS total FROM custody_claims");assert.equal(Number(claims[0].total),2);
 invoke("indexer","dist/project.js",env);const [again]=await conn.query("SELECT COUNT(*) AS total FROM custody_claims");assert.equal(Number(again[0].total),2);
 checks.push("Projector runs repeatedly without duplicate custody receipts; confirmed journals remove serialized transactions.");
 const pendingId=randomUUID();
 await conn.query(`INSERT INTO chain_write_operations
  (operation_id,idempotency_key,request_hash,token_id,tenant_id,organization_id,entity_id,operation_name,role_id,status,transaction_hash,serialized_transaction,nonce,gas_estimate,gas_limit,request_json)
  VALUES (?,?,?,?,?,?,?,?,?,'PREPARED',?,'synthetic-incomplete',0,1,1,'{}')`,
  [pendingId,"synthetic-interrupted","0x"+"aa".repeat(32),shop.user.accountId,other.user.tenantId,shop.user.organizationId,second,"claimCustody","0x"+"00".repeat(32),"0x"+"ab".repeat(32)]);
 const blockedLookup=await request("/receive/"+second,undefined,shop.token);
 assert.equal((await request("/products/"+second+"/receive",{version:blockedLookup.body.version,confirmed:true,idempotencyKey:randomUUID()},shop.token)).status,429);
 await conn.query("DELETE FROM chain_write_operations WHERE operation_id=?",[pendingId]);
 checks.push("An interrupted prepared write blocks a new transaction for the same business until the original operation is recovered.");
 await new Promise(done=>{child.once("exit",done);child.kill("SIGTERM");});
 child=spawn(process.execPath,["dist/server.js"],{cwd:resolve(root,"api"),env:{...env,TRACEFORGE_BROADCAST_ENABLED:"false"},stdio:"ignore"});
 for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error("Disabled isolated API failed to start");try{if((await fetch(api+"/health")).ok)break;}catch{}await new Promise(done=>setTimeout(done,100));}
 const disabled=await generic(other.user.tenantId,second,"close/broadcast",{eventType,evidenceHash,confirm:"BROADCAST"},outsideWriteToken);
 assert.equal(disabled.status,503);assert.equal(disabled.body.error.code,"broadcast_disabled");
 const disableLookup=await request("/receive/"+second,undefined,shop.token);
 assert.equal((await request("/products/"+second+"/receive",{version:disableLookup.body.version,confirmed:true,idempotencyKey:randomUUID()},shop.token)).status,503);
 assert.equal((await read("getEntity",[other.user.tenantId,second])).closed,false);
 const [disabledJournal]=await conn.query("SELECT COUNT(*) AS total FROM chain_write_operations");assert.equal(Number(disabledJournal[0].total),Number(journal[0].total));
 checks.push("Disabling broadcasts blocks both generic and operator writes without creating journal entries or changing chain state.");
 await writeFile(join(tmpdir(),"TraceForge-Direct-Claim-Integration-2026-10-05.json"),JSON.stringify({passed:true,checks,confirmedTransactions:Number(journal[0].total)},null,2));
 console.log(JSON.stringify({passed:true,checks,confirmedTransactions:Number(journal[0].total)},null,2));
} finally {
 child?.kill("SIGTERM");await conn?.end();
 await admin.query("DROP DATABASE IF EXISTS `"+database+"`");await admin.end();await rm(walletDir,{recursive:true,force:true});
}
