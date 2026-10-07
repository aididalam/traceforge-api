// Authorized Pi checkout demo. Tokens stay in an owner-only local file.
import assert from "node:assert/strict";
import {readFile,writeFile,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {homedir} from "node:os";
import {liveBatchContext} from "./live-batch-support.mjs";

if(!process.argv.includes("--broadcast"))throw Error("Use --broadcast for the authorized live ERP demonstration.");
const h=await liveBatchContext();
const reportPath=resolve(h.root,"contracts/deployments/9009/operations/erp-demo.json");
const secrets=resolve(homedir(),".traceforge/secrets"),statePath=resolve(secrets,"erp-demo-keys.json");
try{
 try{
  const prior=JSON.parse(await readFile(reportPath,"utf8"));
  assert.notEqual(prior.contract.address.toLowerCase(),h.address,"This deployment already has ERP evidence; use verify:live-erp.");
 }catch(error){if(error.code!=="ENOENT")throw error;}
 const accountPath=resolve(secrets,"batch-demo-accounts.json");
 assert.equal((await stat(accountPath)).mode&0o077,0);
 const accounts=JSON.parse(await readFile(accountPath,"utf8"));
 let state;
 try{assert.equal((await stat(statePath)).mode&0o077,0);state=JSON.parse(await readFile(statePath,"utf8"));}
 catch(error){if(error.code!=="ENOENT")throw error;state={contract:h.address,occurredAt:new Date().toISOString(),actors:{}};}
 assert.equal(state.contract,h.address,"ERP demo credentials belong to a different deployment.");
 const save=()=>writeFile(statePath,JSON.stringify(state,null,2)+"\n",{mode:0o600});
 await save();
 const actors={};
 for(const [role,index,scopes] of [["producer",0,["products:read","products:create","jobs:read"]],
  ["shop",2,["products:read","products:receive","products:remove","jobs:read"]]]){
  const account=accounts[index],login=await h.call("/login",{email:account.email,password:account.password});
  if(!state.actors[role]){
   const created=await h.request("/operator/v1/integration-keys",{name:"Live ERP demo "+role,scopes,expiresInDays:90},login.sessionToken);
   assert.equal(created.status,201);state.actors[role]=created.body;await save();
  }
  actors[role]={user:login.user,key:state.actors[role]};
 }
 const {producer,shop}=actors;
 const erp=async(actor,path,payload)=>h.request("/integration/v1"+path,payload,actor.key.secret);
 const job=async(actor,payload)=>{
  const accepted=await erp(actor,"/jobs",payload);assert.equal(accepted.status,202,"ERP job was not durably accepted");
  for(let attempt=0;attempt<300;attempt++){
   const poll=await erp(actor,"/jobs/"+accepted.body.jobId);assert.equal(poll.status,200);assert.equal(poll.body.occurredAt,state.occurredAt);
   if(!poll.body.counts.pending){assert.equal(poll.body.status,"COMPLETED",JSON.stringify(poll.body.items.map(i=>({status:i.status,error:i.error}))));return poll.body;}
   await new Promise(done=>setTimeout(done,1000));
  }throw Error("ERP worker did not finish this job; rerun with the same saved keys and payload.");
 };
 const specs=[{stem:"cola",name:"ERP demo Cola batch",initial:100,received:20,sold:2},
  {stem:"soap",name:"ERP demo Soap batch",initial:50,received:10,sold:3},
  {stem:"bottle",name:"ERP demo Bottle",initial:1,received:1,sold:1}];
 const envelope=(key,reference,operations)=>({idempotencyKey:"erp-demo-20261007-"+key,reference,occurredAt:state.occurredAt,operations});
 const operation=(action,spec,data,productCode)=>({action,idempotencyKey:`erp-demo-20261007-${action}-${spec.stem}`,
  ...(productCode?{productCode}:{}),data});
 const registered=await job(producer,envelope("create","ERP-REGISTRATION-20261007",specs.map(s=>operation("create",s,
  {name:s.name,id:producer.user.businessCode+" / ERP-20261007-"+s.stem.toUpperCase(),quantity:s.initial,publish:true,
   fields:[{label:"Description",value:"Real queued ERP checkout demonstration on Pi"},{label:"Origin",value:"বাংলাদেশ"}]}))));
 await h.sync();
 const products=[];
 for(const [index,s] of specs.entries()){
  const product={...registered.items[index].result,name:s.name,externalId:producer.user.businessCode+" / ERP-20261007-"+s.stem.toUpperCase(),tenantId:producer.user.tenantId,publish:true};
  const proof=await h.prove(product);products.push({...product,rootRouteId:proof.rootRouteId});
  const scan=await erp(shop,"/scan?"+new URLSearchParams({code:"http://127.0.0.1:3101/s/"+product.shortCode}));
  assert.equal(scan.status,200);assert.equal(scan.body.trackingId,product.trackingId);
 }
 assert.equal(await h.read("isActiveTenantMember",[producer.user.tenantId,shop.user.organizationId]),false);
 const received=await job(shop,envelope("receive","ERP-RECEIPT-20261007",specs.map((s,i)=>operation("receive",s,
  {confirmed:true,...(s.initial>1?{sourceRouteId:products[i].rootRouteId,quantity:s.received}:{})},products[i].shortCode))));
 await h.sync();
 const checkout=envelope("checkout","ERP-SALE-20261007",specs.map((s,i)=>operation("remove",s,
  {confirmed:true,...(s.initial>1?{routeId:received.items[i].result.receivedRouteId,quantity:s.sold}:{})},products[i].shortCode)));
 const sold=await job(shop,checkout);await h.sync();
 const repeated=await erp(shop,"/jobs",checkout);assert.equal(repeated.status,202);assert.equal(repeated.body.jobId,sold.jobId);
 assert.deepEqual(repeated.body.items.map(i=>i.operationId),sold.items.map(i=>i.operationId));
 assert.equal((await erp(producer,"/jobs/"+sold.jobId)).status,404);
 const proofs=[];
 for(const [i,s] of specs.entries()){
  const product=products[i],proof=await h.prove(product,{available:s.initial-s.sold,
   ...(s.initial>1?{owned:{[producer.user.organizationId]:s.initial-s.received,[shop.user.organizationId]:s.received-s.sold}}:{})});
  assert.equal(proof.reasons.Sold,String(s.sold));
  const [docs]=await h.db.query("SELECT d.document_json FROM chain_write_operations w JOIN offchain_documents d ON d.content_hash=JSON_UNQUOTE(JSON_EXTRACT(w.request_json,'$.args[7]')) WHERE w.operation_id=?",[sold.items[i].result.operationId]);
  assert.equal(docs.length,1);const evidence=typeof docs[0].document_json==="string"?JSON.parse(docs[0].document_json):docs[0].document_json;
  assert.equal(evidence.integration.reference,checkout.reference);assert.equal(evidence.integration.occurredAt,state.occurredAt);
  proofs.push({...proof,tenantId:product.tenantId,publish:true,shopAvailable:String(s.received-s.sold)});
 }
 const jobs=[registered,received,sold],transactions=jobs.flatMap(j=>j.items.map(i=>i.result));
 assert.equal(transactions.length,9);assert.equal(new Set(transactions.map(t=>t.transactionHash)).size,9);
 for(const t of transactions)assert.equal((await h.client.getTransactionReceipt({hash:t.transactionHash})).status,"success");
 const [journal]=await h.db.query("SELECT COUNT(*) total,SUM(status<>'CONFIRMED') pending,SUM(serialized_transaction IS NOT NULL) signed FROM chain_write_operations");
 assert.equal(Number(journal[0].pending),0);assert.equal(Number(journal[0].signed),0);
 const report={schemaVersion:1,passed:true,verifiedAt:new Date().toISOString(),contract:{address:h.address,runtimeBytecodeHash:h.deployment.artifact.expectedRuntimeHash},
  network:{chainId:9009},checks:{queuedBulkCreate:true,queuedBulkReceipt:true,queuedCheckout:true,existingQrCodes:true,noReceivingMembership:true,
   duplicateCheckoutPrevented:true,crossBusinessJobHidden:true,routeConservation:true,onChainReceiptsVerified:true,erpEvidenceHashBound:true,serializedTransactionsCleared:true},
  businesses:[producer,shop].map(a=>({name:a.user.organizationName,organizationId:a.user.organizationId})),
  jobs,products:proofs,transactions,erpConfirmedTransactions:9,totalConfirmedTransactions:Number(journal[0].total)};
 await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({passed:true,erpConfirmedTransactions:9,totalConfirmedTransactions:report.totalConfirmedTransactions,
  products:proofs.map(p=>({name:p.name,shortCode:p.shortCode,available:p.availableQuantity,shopAvailable:p.shopAvailable}))},null,2));
}finally{await h.db.end();}
