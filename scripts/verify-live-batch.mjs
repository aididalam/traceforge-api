import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {liveBatchContext} from "./live-batch-support.mjs";
const h=await liveBatchContext();
try{
 const report=JSON.parse(await readFile(resolve(h.root,"contracts/deployments/9009/operations/batch-demo.json"),"utf8"));
 assert.equal(report.contract.address,h.address);assert.equal(report.passed,true);
 for(const product of report.products){
  const proof=await h.prove(product,{available:product.availableQuantity,owned:product.owned});
  assert.equal(proof.registrationMetadataHash,product.registrationMetadataHash);
  const reference=await h.request("/public/v1/tracking/"+product.trackingId);
  assert.equal(reference.status,product.publish?200:404);
  if(product.publish){
   const history=await h.request(`/public/v1/tenants/${product.tenantId}/entities/${product.trackingId}/history`);assert.equal(history.status,200);
   assert.equal(history.body.entity.quantity.availableQuantity,product.availableQuantity);
   assert.equal(history.body.entity.productInfo.name,product.name);assert.ok(history.body.events.every(e=>e.occurredAt));
   const alias=await h.request("/public/v1/short-links/"+product.shortCode);assert.equal(alias.status,200);
  }
 }
 const [rows]=await h.db.query("SELECT COUNT(*) count,SUM(status<>'CONFIRMED') pending,SUM(serialized_transaction IS NOT NULL) signed FROM chain_write_operations");
 assert.equal(Number(rows[0].count),report.confirmedTransactions);assert.equal(Number(rows[0].pending),0);assert.equal(Number(rows[0].signed),0);
 const [scope]=await h.db.query("SELECT DISTINCT contract_address FROM chain_events");assert.deepEqual(scope.map(r=>r.contract_address),[h.address]);
 console.log(JSON.stringify({passed:true,contract:h.address,products:report.products.length,confirmedTransactions:report.confirmedTransactions,pending:0,signed:0},null,2));
}finally{await h.db.end();}
