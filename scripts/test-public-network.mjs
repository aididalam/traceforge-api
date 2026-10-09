// Execute inside the disposable public-test API container with its own database.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPublicClient,http,parseEther,parseTransaction} from 'viem';
if(process.env.TRACEFORGE_TEST_PUBLIC!=='true'||process.env.TRACEFORGE_NETWORK_KIND!=='public'||
 process.env.MYSQL_DATABASE!=='traceforge_public_test'||process.env.TRACEFORGE_RPC_URL!=='http://host.docker.internal:18655')throw Error('Requires the disposable local public-network Docker fixture');
const modules=process.env.TRACEFORGE_TEST_DIST||new URL('../dist/',import.meta.url).href;
const {db}=await import(modules+'db.js'),{config}=await import(modules+'config.js'),{traceForgeWriteAbi:abi}=await import(modules+'traceforge-write-abi.js');
const {processErpQueueOnce}=await import(modules+'erp-queue.js');
const client=createPublicClient({transport:http(process.env.TRACEFORGE_RPC_URL)}),address=config.traceforge.contractAddress;
const api='http://127.0.0.1:3000',checks=[],runId=randomUUID().slice(0,8);
const request=async(path,body,token,prefix='/operator/v1')=>{
 const response=await fetch(api+prefix+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();assert(response.ok,JSON.stringify({path,status:response.status,error:result.error}));return result;
};
const read=(functionName,args)=>client.readContract({address,abi,functionName,args});
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const until=async(check)=>{for(let i=0;i<80;i++){if(await check())return;await delay(500);}throw Error('Test state did not become available');};
try{
 assert.equal(await client.getChainId(),80002);
 const actors=[];
 for(const businessName of ['Public Test Producer','Public Test Receiver']){
  const input={email:businessName.toLowerCase().replaceAll(' ','.')+'.'+runId+'@example.test',password:'Synthetic-Public-Test-2026',name:'Test Operator',businessName,businessType:'Inspection and resale',publicProfile:true};
  const pending=await request('/signup',input);assert.equal(pending.pending,true);assert(pending.funding?.walletAddress);
  await client.request({method:'hardhat_setBalance',params:[pending.funding.walletAddress,'0x'+parseEther('1').toString(16)]});
  const complete=await request('/signup',input);assert.equal(complete.created,true);
  await until(async()=>{const [rows]=await db.query('SELECT o.organization_id FROM organizations o JOIN business_wallets b ON b.organization_id=o.organization_id WHERE b.wallet_address=? AND o.active=TRUE',[pending.funding.walletAddress.toLowerCase()]);return rows.length===1;});
  const login=await request('/login',{email:input.email,password:input.password});actors.push({token:login.sessionToken,user:login.user,address:pending.funding.walletAddress});
 }
 checks.push('Independent public-network signup returns a funding address and activates after funded, finalized registration.');
const [producer,receiver]=actors;
 await client.request({method:'traceforge_test_setFinalityLag',params:[100]});
 const input={name:'Public test single',id:'PUBLIC-SERIAL-1',fields:[{label:'Origin',value:'Bangladesh'}],publish:true,idempotencyKey:randomUUID()};
 const pending=await request('/products/create',input,producer.token);assert.equal(pending.status,'BROADCAST');
 const retry=await request('/products/create',input,producer.token);assert.equal(retry.status,'BROADCAST');assert.equal(retry.transactionHash,pending.transactionHash);
 const [unconfirmed]=await db.query('SELECT confirmed FROM business_product_records WHERE tracking_id=?',[pending.trackingId]);assert.equal(Number(unconfirmed[0].confirmed),0);
 const [writes]=await db.query('SELECT COUNT(*) n FROM chain_write_operations WHERE operation_id=?',[pending.operationId]);assert.equal(Number(writes[0].n),1);
 await client.request({method:'traceforge_test_setFinalityLag',params:[0]});
 const single=await request('/products/create',input,producer.token);assert.equal(single.status,'CONFIRMED');assert.equal(single.transactionHash,pending.transactionHash);assert(single.shortCode);
 assert((await client.getTransactionReceipt({hash:single.transactionHash})).effectiveGasPrice>0n);
 checks.push('A mined product stays pending before finality; retry finalizes the original paid transaction once.');
 const batch=await request('/products/create',{name:'Public test batch',id:'PUBLIC-BATCH-1',quantity:100,publish:true,idempotencyKey:randomUUID()},producer.token);assert.equal(batch.status,'CONFIRMED');
 const root=(await read('getProduct',[producer.user.tenantId,batch.trackingId])).rootRouteId;
 const received=await request('/products/'+batch.trackingId+'/receive',{sourceRouteId:root,quantity:10,version:'0',confirmed:true,idempotencyKey:randomUUID()},receiver.token);assert.equal(received.status,'CONFIRMED');
 const claimed=await request('/products/'+single.trackingId+'/receive',{version:'0',confirmed:true,idempotencyKey:randomUUID()},receiver.token);assert.equal(claimed.status,'CONFIRMED');
 const key=await request('/integration-keys',{name:'Public test checkout',scopes:['products:read','products:remove','jobs:read'],expiresInDays:30},receiver.token);
 const checkout={idempotencyKey:randomUUID(),reference:'PUBLIC-CHECKOUT-001',operations:[
  {action:'remove',productCode:batch.shortCode,idempotencyKey:randomUUID(),data:{routeId:received.receivedRouteId,quantity:2,reason:'Sold',confirmed:true}},
  {action:'remove',productCode:single.shortCode,idempotencyKey:randomUUID(),data:{reason:'Sold',confirmed:true}}]};
 const job=await request('/jobs',checkout,key.secret,'/integration/v1');
 await until(async()=>{await processErpQueueOnce();return (await request('/jobs/'+job.jobId,undefined,key.secret,'/integration/v1')).status==='COMPLETED';});
 const result=await request('/jobs/'+job.jobId,undefined,key.secret,'/integration/v1');assert.equal(result.counts.confirmed,2);
 const replay=await request('/jobs',checkout,key.secret,'/integration/v1');assert.equal(replay.jobId,job.jobId);
 assert.equal((await read('getProduct',[producer.user.tenantId,batch.trackingId])).availableQuantity,98n);
 assert.equal((await read('getBatchRoute',[producer.user.tenantId,batch.trackingId,received.receivedRouteId])).availableQuantity,8n);
 assert.equal((await read('getProduct',[producer.user.tenantId,single.trackingId])).availableQuantity,0n);
 checks.push('Single receipt, batch stock routes and queued ERP checkout produce correct paid-gas stock totals; replay does not repeat removal.');
 // Reorganize only an unfinalized transaction, then raise the base fee so its
 // original signed attempt cannot enter the replacement block.
 await client.request({method:'traceforge_test_setFinalityLag',params:[100]});
 const snapshot=await client.request({method:'evm_snapshot'});
 const recoveryInput={name:'Public recovery item',id:'PUBLIC-RECOVERY-'+runId,publish:false,idempotencyKey:randomUUID()};
 const original=await request('/products/create',recoveryInput,producer.token);assert.equal(original.status,'BROADCAST');
 const [before]=await db.query('SELECT serialized_transaction FROM chain_write_attempts WHERE operation_id=?',[original.operationId]);
 const originalTx=parseTransaction(before[0].serialized_transaction);
 assert.equal(await client.request({method:'evm_revert',params:[snapshot]}),true);
 await client.request({method:'hardhat_setNextBlockBaseFeePerGas',params:['0x12a05f200']});
 await client.request({method:'evm_mine'});
 await db.query('UPDATE chain_write_attempts SET created_at=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 180 SECOND) WHERE operation_id=?',[original.operationId]);
 const replaced=await request('/products/create',recoveryInput,producer.token);assert.equal(replaced.status,'BROADCAST');assert.notEqual(replaced.transactionHash,original.transactionHash);
 const [attempts]=await db.query('SELECT serialized_transaction FROM chain_write_attempts WHERE operation_id=? ORDER BY attempt_id',[original.operationId]);
 assert.equal(attempts.length,2);const replacementTx=parseTransaction(attempts[1].serialized_transaction);
 assert.equal(replacementTx.nonce,originalTx.nonce);assert.equal(replacementTx.data,originalTx.data);assert(replacementTx.maxFeePerGas>originalTx.maxFeePerGas);
 await client.request({method:'traceforge_test_setFinalityLag',params:[0]});
 const recovered=await request('/products/create',recoveryInput,producer.token);assert.equal(recovered.status,'CONFIRMED');assert.equal(recovered.transactionHash,replaced.transactionHash);
 assert.equal((await read('getProduct',[producer.user.tenantId,recovered.trackingId])).initialQuantity,1n);
 checks.push('An orphaned pending write is recovered with a higher fee and the same nonce/payload; finalization selects the actual mined attempt without duplicate registration.');
 await until(async()=>{const [rows]=await db.query("SELECT COUNT(*) n FROM quantity_movements WHERE action='REMOVED'");return Number(rows[0].n)>=2;});
 const [checkpoint]=await db.query('SELECT last_processed_hash FROM indexer_checkpoints');assert.match(checkpoint[0].last_processed_hash,/^0x[0-9a-f]{64}$/i);
 const [signed]=await db.query('SELECT COUNT(*) n FROM chain_write_attempts a JOIN chain_write_operations w ON w.operation_id=a.operation_id WHERE w.status=\'CONFIRMED\' AND a.serialized_transaction IS NOT NULL');assert.equal(Number(signed[0].n),0);
 const [transactions]=await db.query('SELECT transaction_hash FROM chain_write_operations WHERE status=\'CONFIRMED\'');
 for(const tx of transactions)assert((await client.getTransactionReceipt({hash:tx.transaction_hash})).effectiveGasPrice>0n);
 checks.push('Indexer canonical checkpoint and finalized quantity projections agree with contract state; completed signed payloads are cleared.');
 console.log(JSON.stringify({passed:true,confirmedTransactions:transactions.length,checks},null,2));
}finally{await client.request({method:'traceforge_test_setFinalityLag',params:[0]}).catch(()=>{});await db.end();}
