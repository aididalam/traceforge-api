// Explicit Pi demo. Sign-in secrets are read/written only in an owner-only file.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {homedir} from "node:os";
import {randomBytes} from "node:crypto";
import {keccak256,stringToHex} from "viem";
import {liveBatchContext} from "./live-batch-support.mjs";
if(!process.argv.includes("--broadcast"))throw Error("Use --broadcast to perform the authorized live operations.");
const h=await liveBatchContext(),{root,address,deployment,db,read,call,request,sync,prove,base}=h;
const reportPath=resolve(root,"contracts/deployments/9009/operations/batch-demo.json");
const credentialFile=process.env.TRACEFORGE_DEMO_ACCOUNTS_FILE??resolve(homedir(),".traceforge/secrets/batch-demo-accounts.json");
const expectedNames=["Producer","Distributor","Shop","Cold storage service"];
let accounts;
try{assert.equal((await stat(credentialFile)).mode&0o077,0);accounts=JSON.parse(await readFile(credentialFile,"utf8"));}
catch(error){if(error.code!=="ENOENT")throw error;accounts=expectedNames.map((type,i)=>({type,name:i===3?"TraceForge Demo Distributor B":"TraceForge Demo "+type,email:i===3?"distributor.b@traceforge.test":type.toLowerCase()+"@traceforge.test",password:randomBytes(24).toString("base64url")}));await writeFile(credentialFile,JSON.stringify(accounts,null,2)+"\n",{flag:"wx",mode:0o600});}
assert.equal(accounts.length,4);
try{
 try{const prior=JSON.parse(await readFile(reportPath,"utf8"));if(prior.contract.address.toLowerCase()===address)throw Error("This deployment already has demo evidence. Use verify-live-batch.mjs for read-only checks.");}catch(error){if(error.code!=="ENOENT")throw error;}
 const actors=[],transactions=[],checkpoints=[],products=[];
 for(const account of accounts){
  const login=await request("/operator/v1/login",{email:account.email,password:account.password});
  if(login.status!==200){const signup=await call("/signup",{email:account.email,password:account.password,name:"Demo Operator",businessName:account.name,businessType:account.type,publicProfile:true});assert.equal(signup.created,true);await sync();}
  const signedIn=await call("/login",{email:account.email,password:account.password});actors.push({...account,token:signedIn.sessionToken,user:signedIn.user});
 }
 const [producer,a,shop,b]=actors;
 for(const receiver of [a,b,shop])assert.equal(await read("isActiveTenantMember",[producer.user.tenantId,receiver.user.organizationId]),false);
 const checkpoint=async(product,available,owned)=>{await sync();const proof=await prove(product,{available,owned});checkpoints.push(proof);console.log("Live checkpoint "+JSON.stringify({name:proof.name,available:proof.availableQuantity,removed:proof.removedQuantity,routes:proof.routes}));return proof;};
 const create=async(name,reference,quantity,key,publish=true)=>{
  const result=await call("/products/create",{name,id:reference,...(quantity!==1?{quantity}:{}),fields:[{label:"Description",value:publish?"Real TraceForge development demo on Pi":"PRIVATE_LIVE_BATCH_NOTE"},{label:"Origin",value:"বাংলাদেশ"}],publish,idempotencyKey:"phase6-"+key},producer.token);
  assert.equal(result.status,"CONFIRMED");transactions.push(result);const product={...result,name,externalId:reference,tenantId:producer.user.tenantId,publish};
  const proof=await checkpoint(product,quantity);product.rootRouteId=proof.rootRouteId;product.registrationMetadataHash=proof.registrationMetadataHash;products.push(product);return product;
 };
 const receive=async(product,actor,source,quantity,key)=>{
  const preview=await call("/receive/"+product.shortCode,undefined,actor.token);
  const selected=source?preview.routes.find(r=>r.id===source):null;assert.equal(preview.canReceive,true);if(source)assert.ok(selected);
  const body={version:source?selected.version:preview.version,confirmed:true,idempotencyKey:"phase6-"+key,...(source?{sourceRouteId:source,quantity}:{})};
  const pending=await call(`/products/${product.trackingId}/receive`,body,actor.token);
  const result=await h.approve(pending,actors);transactions.push(result);await checkpoint(product,Number((await read("getProduct",[product.tenantId,product.trackingId])).availableQuantity));return result.receivedRouteId;
 };
 const remove=async(product,actor,route,quantity,key,reason="Sold",reasonText="")=>{
  const version=route?(await read("getBatchRoute",[product.tenantId,product.trackingId,route])).version:(await read("getCustodyVersion",[product.tenantId,product.trackingId]));
  const result=await call(`/products/${product.trackingId}/remove`,{version:version.toString(),confirmed:true,idempotencyKey:"phase6-"+key,reason,reasonText,...(route?{routeId:route,quantity}:{})},actor.token);
  assert.equal(result.status,"CONFIRMED");transactions.push(result);await checkpoint(product,Number((await read("getProduct",[product.tenantId,product.trackingId])).availableQuantity));
 };
 const batchId=producer.user.businessCode+" / COLA-BATCH-20261006";
 const batch=await create("Demo Cola batch",batchId,1000000,"million-batch");
 const ra=await receive(batch,a,batch.rootRouteId,600000,"a-root"),rb=await receive(batch,b,batch.rootRouteId,400000,"b-root");
 const sa=await receive(batch,shop,ra,250000,"shop-a"),sb=await receive(batch,shop,rb,150000,"shop-b");
 await receive(batch,producer,sa,50000,"producer-return");await receive(batch,shop,ra,100000,"shop-a-second");
 await remove(batch,shop,sb,100000,"bulk-sold");await remove(batch,shop,sa,200,"lost","Lost","পরিবহনের সময় হারিয়েছে");
 await remove(batch,a,ra,500,"spoiled","Spoiled","Packaging damaged during storage");
 await prove(batch,{available:899300,owned:{[producer.user.organizationId]:50000,[a.user.organizationId]:249500,[b.user.organizationId]:250000,[shop.user.organizationId]:349800}});
 const duplicate=await create("Another Cola batch",batchId,10,"duplicate-reference");
 const open=await create("Demo Bottle",producer.user.businessCode+" / SERIAL-20261006-001",1,"claimable-single");
 const single=await create("Demo Glass Bottle",producer.user.businessCode+" / SERIAL-20261006-002",1,"closed-single");
 await receive(single,a,undefined,1,"single-a");await receive(single,shop,undefined,1,"single-shop");await remove(single,shop,undefined,1,"single-damaged","Damaged","Broken glass during handling");
 const exhausted=await create("Demo completed batch",producer.user.businessCode+" / COMPLETE-BATCH-20261006",10,"complete-batch");
 const eb=await receive(exhausted,b,exhausted.rootRouteId,6,"complete-b"),es=await receive(exhausted,shop,exhausted.rootRouteId,4,"complete-shop");
 await remove(exhausted,b,eb,6,"complete-b-sold");await remove(exhausted,shop,es,3,"complete-shop-lost","Lost","Three items lost during handling");
 assert.equal((await prove(exhausted,{available:1})).isBatch,true);await remove(exhausted,shop,es,1,"complete-last","Disposed","Final item withdrawn by shop");
 const privateProduct=await create("Private development batch","PRIVATE-BATCH-20261006",50,"private-batch",false);
 assert.equal((await request("/public/v1/tracking/"+privateProduct.trackingId)).status,404);
 const privatePreview=await call("/receive/"+privateProduct.shortCode,undefined,a.token);assert.equal(privatePreview.name,null);assert.equal(privatePreview.quantity.externalId,null);
 const search=await request("/public/v1/products/search?"+new URLSearchParams({id:batchId}));assert.equal(search.status,200);assert.equal(search.body.products.length,2);
 // Reject invalid operations by eth_call, leaving no failed live transaction or document.
 const [wallets]=await db.query("SELECT organization_id,wallet_address FROM business_wallets");
 const wallet=actor=>wallets.find(row=>row.organization_id===actor.user.organizationId).wallet_address;
 const source=await read("getBatchRoute",[batch.tenantId,batch.trackingId,ra]),evidence=keccak256(stringToHex("LIVE_PHASE6_VALIDATION")),child=keccak256(stringToHex("LIVE_PHASE6_REJECTED_ROUTE"));
 const simulate=(actor,functionName,args)=>h.client.simulateContract({address,abi:h.abi,account:wallet(actor),functionName,args});
 await assert.rejects(()=>simulate(shop,"removeProduct",[batch.tenantId,batch.trackingId,ra,1n,source.version,0,"",evidence]),/NotRouteOwner/);
 await assert.rejects(()=>simulate(a,"removeProduct",[batch.tenantId,batch.trackingId,ra,source.availableQuantity+1n,source.version,0,"",evidence]),/InsufficientQuantity/);
 const approval=(tenantId,entityId,sourceRouteId,expectedVersion,receiver)=>({tenantId,entityId,sourceRouteId,receivedRouteId:child,requestId:child,receiverWallet:wallet(receiver),expectedVersion,quantity:1n,expiresAt:BigInt(Math.floor(Date.now()/1000)+3600),evidenceHash:evidence});
 await assert.rejects(()=>simulate(a,"approveReceipt",[approval(batch.tenantId,batch.trackingId,ra,source.version-1n,b)]),/StaleRoute/);
 await assert.rejects(()=>simulate(a,"approveReceipt",[approval(batch.tenantId,batch.trackingId,ra,source.version,a)]),/InvalidCustodyRecipient/);
 await assert.rejects(()=>simulate(shop,"approveReceipt",[approval(exhausted.tenantId,exhausted.trackingId,es,0n,a)]),/EntityIsClosed/);
 const snapshot=async()=>JSON.stringify(Object.fromEntries(await Promise.all(["product_quantities","batch_routes","quantity_movements","custody_claims","receipt_approvals","entities"].map(async table=>[table,(await db.query("SELECT * FROM "+table+" ORDER BY 1,2,3"))[0]]))));
 const before=await snapshot();for(const args of [[],["--rebuild"]]){const {spawnSync}=await import("node:child_process");const result=spawnSync(process.execPath,["dist/project.js",...args],{cwd:resolve(root,"indexer"),env:process.env,encoding:"utf8",timeout:30000});assert.equal(result.status,0);assert.equal(await snapshot(),before);}
 const proofs=[];for(const product of products)proofs.push({...await prove(product),tenantId:product.tenantId,publish:product.publish});
 const [journal]=await db.query("SELECT COUNT(*) total,SUM(status<>'CONFIRMED') unconfirmed,SUM(serialized_transaction IS NOT NULL) signed FROM chain_write_operations");assert.equal(Number(journal[0].unconfirmed),0);assert.equal(Number(journal[0].signed),0);
 const report={schemaVersion:1,passed:true,network:{chainId:9009,deploymentBlock:deployment.deployment.blockNumber},contract:{address,runtimeBytecodeHash:deployment.artifact.expectedRuntimeHash},
  businesses:actors.map(actor=>({name:actor.name,type:actor.type,organizationId:actor.user.organizationId,tenantId:actor.user.tenantId,businessCode:actor.user.businessCode})),
  checks:{independentSignup:true,noReceivingMembership:true,routeConservation:true,registrationHashUnchanged:true,exactOnChainReasons:true,duplicateSearch:true,privatePreview:true,nonOwnerRejected:true,overdrawRejected:true,staleReceiptRejected:true,selfReceiptRejected:true,closedBatchRejected:true,incrementalReplay:true,fullRebuild:true,journalsConfirmed:true,serializedTransactionsCleared:true},
  products:proofs,checkpoints,transactions,confirmedTransactions:Number(journal[0].total),claimableProduct:open.trackingId,batchProduct:batch.trackingId};
 await mkdir(resolve(root,"contracts/deployments/9009/operations"),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({passed:true,confirmedTransactions:report.confirmedTransactions,products:proofs.map(p=>({name:p.name,trackingId:p.trackingId,shortCode:p.shortCode,available:p.availableQuantity})),base},null,2));
}finally{await db.end();}
