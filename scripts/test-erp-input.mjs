import assert from "node:assert/strict";
import {test} from "node:test";
import {loadSourceFile} from "./test-source-loader.mjs";
const {parseErpBatch,erpProductCode,parseErpScopes}=await loadSourceFile("src/erp-input.ts");
const code="0x"+"a1".repeat(32),route="0x"+"b2".repeat(32);
const sale=(extra={})=>({idempotencyKey:"receipt_001",reference:"SALE-001",occurredAt:"2026-10-07T08:00:00Z",
 operations:[{action:"remove",idempotencyKey:"receipt_001_line_01",productCode:code,data:{quantity:2,routeId:route,confirmed:true}}],...extra});
test("Existing TraceForge codes and QR links normalize without fetching the URL",()=>{
 for(const input of [code,code.toUpperCase().replace("0X","0x"),"https://example.test/track/"+code])assert.equal(erpProductCode(input),code);
 assert.equal(erpProductCode("https://example.test/s/E382NQ6DRB4D/"),"e382nq6drb4d");
 for(const invalid of ["1234567890123","file:///s/e382nq6drb4d","https://user:secret@example.test/s/e382nq6drb4d","https://example.test/s/e382nq6drb4d?token=secret","https://example.test/other/e382nq6drb4d","https://example.test/s/e382nq6drb4d#token",null])assert.throws(()=>erpProductCode(invalid));
});
test("Completed checkout normalizes Sold defaults and an exact ISO sale time",()=>{
 const parsed=parseErpBatch(sale());assert.equal(parsed.occurredAt,"2026-10-07T08:00:00.000Z");
 assert.deepEqual(parsed.operations[0].data,{confirmed:true,quantity:2,routeId:route,reason:"Sold",reasonText:""});
 for(const invalid of ["2026-02-30T08:00:00Z","2026-10-07","2026-10-07T25:00:00Z","0000-01-01T00:00:00Z",1,null])assert.throws(()=>parseErpBatch(sale({occurredAt:invalid})));
});
test("Product registration uses existing metadata, defaults and count bounds",()=>{
 const body={idempotencyKey:"create_many_01",operations:[{action:"create",idempotencyKey:"create_item_01",data:{name:" Cola ",id:" BATCH-01 ",publish:false,fields:[{label:"Origin",value:"বাংলাদেশ"}]}}]};
 const result=parseErpBatch(body);assert.equal(result.operations[0].data.quantity,1);assert.equal(result.operations[0].data.id,"BATCH-01");assert.equal(result.operations[0].data.name,"Cola");
 for(const invalid of [0,-1,1.2,"2",null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>parseErpBatch({...body,operations:[{...body.operations[0],data:{...body.operations[0].data,quantity:invalid}}]}));
 assert.equal(parseErpBatch({...body,operations:[{...body.operations[0],data:{...body.operations[0].data,quantity:Number.MAX_SAFE_INTEGER}}]}).operations[0].data.quantity,Number.MAX_SAFE_INTEGER);
});
test("Bulk requests reject unknown identity fields, duplicate keys and oversized arrays",()=>{
 const body=sale(),item=body.operations[0];
 for(const bad of [{...body,organizationId:code},{...body,operations:[{...item,actor:code}]},{...body,operations:[{...item,data:{...item.data,secret:"hidden"}}]},
  {...body,operations:[item,item]},{...body,operations:[]},{...body,operations:Array.from({length:101},(_,i)=>({...item,idempotencyKey:"sale_line_"+i}))},[]])assert.throws(()=>parseErpBatch(bad));
 assert.equal(parseErpBatch({...body,operations:Array.from({length:100},(_,i)=>({...item,idempotencyKey:"sale_line_"+i}))}).operations.length,100);
});
test("Receipt/removal confirmation, Unicode reasons and versions are validated before queueing",()=>{
 const body=sale(),item=body.operations[0];
 const withData=data=>({...body,operations:[{...item,data:{...item.data,...data}}]});
 for(const data of [{confirmed:false},{confirmed:"true"},{quantity:"2"},{quantity:0},{version:"18446744073709551616"},{version:"01"},{routeId:"wrong"},{reason:"Lost",reasonText:""},{reason:"Spoiled",reasonText:"x".repeat(257)},{reason:"Other",reasonText:"\ud800"}])assert.throws(()=>parseErpBatch(withData(data)));
 assert.equal(parseErpBatch(withData({reason:"Lost",reasonText:"পরিবহনের সময় হারিয়েছে"})).operations[0].data.reasonText,"পরিবহনের সময় হারিয়েছে");
 const receive={...item,action:"receive",data:{sourceRouteId:route,quantity:2,confirmed:true}};
 assert.equal(parseErpBatch({...body,operations:[receive]}).operations[0].data.version,undefined);
 assert.throws(()=>parseErpBatch({...body,operations:[{...receive,data:{...receive.data,reason:"Sold"}}]}));
});
test("Scope grants are explicit, bounded and cannot use generic chain permissions",()=>{
 assert.deepEqual(parseErpScopes(["products:remove","jobs:read"]),["jobs:read","products:remove"]);
 for(const value of [[],["chain:write"],["products:read","products:read"],"products:read",null])assert.throws(()=>parseErpScopes(value));
});
