import test from 'node:test';
import assert from 'node:assert/strict';
import {feePlan,transactionPolicy,requireGasBalance,receiptFinalized} from '../dist/transaction-policy.js';
const settings=transactionPolicy({TRACEFORGE_NETWORK_KIND:'public',TRACEFORGE_MAX_FEE_GWEI:'100',TRACEFORGE_MAX_TRANSACTION_FEE:'0.01'});
const client={getBlock:async()=>({baseFeePerGas:10_000_000_000n}),estimateFeesPerGas:async()=>({maxFeePerGas:22_000_000_000n,maxPriorityFeePerGas:2_000_000_000n}),getGasPrice:async()=>20_000_000_000n};
test('private writes preserve the existing zero-fee policy',async()=>{
 assert.deepEqual(await feePlan({},transactionPolicy({})),{type:'legacy',gasPrice:0n});
 await requireGasBalance({},'0x1',100000n,{type:'legacy',gasPrice:0n},0n,transactionPolicy({}));
});
test('public fees follow base fee and replacements increase both fee fields',async()=>{
 const fees=await feePlan(client,settings);assert.equal(fees.type,'eip1559');
 const next=await feePlan(client,settings,fees);assert(next.maxFeePerGas>fees.maxFeePerGas);assert(next.maxPriorityFeePerGas>fees.maxPriorityFeePerGas);
 const legacy=await feePlan({...client,getBlock:async()=>({baseFeePerGas:0n})},settings);
 assert.deepEqual(legacy,{type:'legacy',gasPrice:20_000_000_000n});
 await assert.rejects(feePlan({...client,getGasPrice:async()=>200_000_000_000n}, {...settings,feeMode:'legacy'}),{code:'fee_limit_exceeded'});
});
test('gas funding checks include native transfers and enforce a total fee cap',async()=>{
 const fees={type:'legacy',gasPrice:20_000_000_000n};
 await assert.rejects(requireGasBalance({getBalance:async()=>0n},'0x1',21000n,fees,0n,settings),{code:'insufficient_gas_balance'});
 await requireGasBalance({getBalance:async()=>10n**18n},'0x1',21000n,fees,0n,settings);
 await assert.rejects(requireGasBalance({getBalance:async()=>10n**18n},'0x1',21000n,fees,10n**18n,settings),{code:'insufficient_gas_balance'});
 await assert.rejects(requireGasBalance({},'0x1',10_000_000n,fees,0n,settings),{code:'fee_limit_exceeded'});
});
test('public confirmation waits for a canonical finalized block and never falls back to latest',async()=>{
 const receipt={blockNumber:10n,blockHash:'0xabc'};
 assert.equal(await receiptFinalized({getBlock:async({blockTag})=>blockTag?{number:9n}:{hash:'0xabc'}},receipt,settings),false);
 assert.equal(await receiptFinalized({getBlock:async({blockTag})=>blockTag?{number:10n}:{hash:'0xabc'}},receipt,settings),true);
 assert.equal(await receiptFinalized({getBlock:async()=>({hash:'0xdef'})},receipt,settings),false);
 await assert.rejects(receiptFinalized({getBlock:async({blockTag})=>blockTag?{number:null}:{hash:'0xabc'}},receipt,settings),{code:'finality_unavailable'});
});
