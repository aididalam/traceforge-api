import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {loadSourceFile} from './test-source-loader.mjs';
const {validateReceiptInput,receiptDecisions}=await loadSourceFile('src/receipt-input.ts');
test('receipt requests require physical confirmation and bounded stock/version inputs',()=>{
 const valid={version:'0',confirmed:true,idempotencyKey:randomUUID()};
 assert.doesNotThrow(()=>validateReceiptInput(valid));
 assert.doesNotThrow(()=>validateReceiptInput({...valid,quantity:Number.MAX_SAFE_INTEGER,sourceRouteId:'0x'+'ab'.repeat(32)}));
 for(const invalid of [{...valid,confirmed:false},{...valid,owner:'0x'+'ab'.repeat(32)},
  {...valid,version:'18446744073709551616'},{...valid,version:0},{...valid,sourceRouteId:'0x123'},
  ...[0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'10',null].map(quantity=>({...valid,quantity}))])assert.throws(()=>validateReceiptInput(invalid));
});
test('bulk decisions accept 1–100 unique request IDs and forbid identity overrides',()=>{
 const valid={requestIds:[randomUUID()],action:'approve',idempotencyKey:randomUUID()};
 for(const action of ['approve','decline','cancel'])assert.equal(receiptDecisions({...valid,action}).action,action);
 assert.equal(receiptDecisions({...valid,requestIds:Array.from({length:100},()=>randomUUID())}).requestIds.length,100);
 const mixed='abcdef12-1234-4234-8234-123456789abc';
 for(const invalid of [{...valid,requestIds:[]},{...valid,requestIds:Array.from({length:101},()=>randomUUID())},
  {...valid,requestIds:[mixed,mixed.toUpperCase()]},{...valid,requestIds:['bad']},
  {...valid,requestIds:[valid.requestIds[0],valid.requestIds[0]]},{...valid,action:'transfer'},
  {...valid,quantity:999},{...valid,receiverWallet:'0x'+'ab'.repeat(20)},{...valid,idempotencyKey:'x'}])assert.throws(()=>receiptDecisions(invalid));
});
