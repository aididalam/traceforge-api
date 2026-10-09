import assert from "node:assert/strict";
import {loadSourceFile} from "./test-source-loader.mjs";
const {productRegistration,productId,productQuantity,removalInput}=await loadSourceFile("src/product-input.ts");
const {businessCodeAt,normalizeBusinessCode}=await loadSourceFile("src/business-codes.ts");
assert.equal(productQuantity(),1);
for(const value of [1,2,1000000,Number.MAX_SAFE_INTEGER])assert.equal(productQuantity(value),value);
for(const value of [null,true,"2",0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>productQuantity(value));
assert.equal(productId("  Batch-001 / বাংলাদেশ  "),"Batch-001 / বাংলাদেশ");
for(const value of [null,1,"","  ","x".repeat(121),"bad\nID","bad\u0085ID","bad\uD800"] )assert.throws(()=>productId(value));
const saved=productRegistration({name:" Tea ",id:" batch-01 ",quantity:10,fields:[{label:"Origin",value:"বাংলাদেশ"}]});
assert.deepEqual(saved,{schemaVersion:2,name:"Tea",id:"batch-01",quantity:10,fields:[{label:"Origin",value:"বাংলাদেশ"}]});
for(const label of ["id"," ID ","Quantity","Name","schemaVersion","Initial quantity"])
 assert.throws(()=>productRegistration({name:"Tea",id:"1",fields:[{label,value:"Override"}]}));
assert.deepEqual(removalInput({}),{reason:"Sold",reasonText:""});
for(const reason of ["Lost","Damaged","Spoiled","Disposed","Other"]){
 assert.throws(()=>removalInput({reason}));assert.throws(()=>removalInput({reason,reasonText:" \t\n "}));
 assert.equal(removalInput({reason,reasonText:"পণ্য হারিয়েছে"}).reasonText,"পণ্য হারিয়েছে");
}
for(const reasonText of ["x".repeat(257),"bad\u0000text","bad\u0085text","\uD800"])
 assert.throws(()=>removalInput({reason:"Sold",reasonText}));
assert.equal(removalInput({reason:"Other",reasonText:"😀".repeat(256)}).reasonText.length,512);
assert.equal(normalizeBusinessCode(" ab9 "),"AB9");
for(const code of ["","a-b","a/b","a b","বাংলা","x".repeat(17)])assert.throws(()=>normalizeBusinessCode(code));
assert.equal(businessCodeAt(1,0n),"A");assert.equal(businessCodeAt(1,35n),"9");
assert.equal(businessCodeAt(2,0n),"AA");assert.equal(businessCodeAt(2,1295n),"99");
assert.equal(businessCodeAt(3,0n),"AAA");assert.throws(()=>businessCodeAt(1,36n));
console.log("Product input checks passed: immutable registration JSON, safe integer counts, reserved fields, Unicode IDs/reasons and business-code boundaries.");

const {businessReceiptMatches}=await loadSourceFile("src/business-receipt.ts");
const hash=byte=>"0x"+byte.repeat(32),actor="0x"+"ab".repeat(20);
const base={accountId:"synthetic",organizationId:hash("11"),tenantId:hash("22"),entityId:hash("33"),idempotencyKey:"synthetic-request",expectedEvent:"QuantityRemoved"};
const receiptInput={...base,operation:"removeProduct",args:[base.tenantId,base.entityId,hash("44"),10n,3n,1,"Lost in transit",hash("55")]};
const receipt={tenantId:base.tenantId,entityId:base.entityId,organizationId:base.organizationId,actor,routeId:hash("44"),quantity:10n,version:4n,reason:1,reasonText:"Lost in transit",evidenceHash:hash("55")};
assert.equal(businessReceiptMatches(receiptInput,receipt,actor),true);
for(const [key,value] of Object.entries({tenantId:hash("99"),entityId:hash("99"),organizationId:hash("99"),actor:"0x"+"99".repeat(20),routeId:hash("99"),quantity:11n,version:3n,reason:2,reasonText:"Changed",evidenceHash:hash("99")}))
 assert.equal(businessReceiptMatches(receiptInput,{...receipt,[key]:value},actor),false,"Mismatched removal receipt: "+key);
const approval={tenantId:base.tenantId,entityId:base.entityId,sourceRouteId:hash("44"),receivedRouteId:hash("66"),requestId:hash("77"),receiverWallet:"0x"+"cd".repeat(20),expectedVersion:2n,quantity:100n,expiresAt:4000000000n,evidenceHash:hash("55")};
const receiveInput={...base,operation:"approveReceipt",args:[approval]};
const receiveReceipt={tenantId:base.tenantId,entityId:base.entityId,fromOrganizationId:base.organizationId,toOrganizationId:hash("88"),requesterWallet:approval.receiverWallet,approverWallet:actor,requestId:approval.requestId,sourceRouteId:approval.sourceRouteId,receivedRouteId:approval.receivedRouteId,quantity:100n,evidenceHash:approval.evidenceHash};
assert.equal(businessReceiptMatches(receiveInput,receiveReceipt,actor),true);
for(const [key,value] of Object.entries({tenantId:hash("99"),entityId:hash("99"),sourceRouteId:hash("99"),receivedRouteId:hash("99"),quantity:99n,fromOrganizationId:hash("99"),requestId:hash("99"),requesterWallet:actor,approverWallet:approval.receiverWallet,evidenceHash:hash("99")}))
 assert.equal(businessReceiptMatches(receiveInput,{...receiveReceipt,[key]:value},actor),false,"Mismatched approval receipt: "+key);
console.log("Receipt verification checks passed: mismatched actor, product, routes, quantities, versions, reasons and evidence cannot confirm a journal.");
