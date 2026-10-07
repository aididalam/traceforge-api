import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {decodeEventLog,keccak256,stringToHex} from "viem";
import {liveBatchContext} from "./live-batch-support.mjs";
const h=await liveBatchContext();
try{
 const report=JSON.parse(await readFile(resolve(h.root,"contracts/deployments/9009/operations/erp-demo.json"),"utf8"));
 assert.equal(report.passed,true);assert.equal(report.contract.address,h.address);
 for(const product of report.products){
  await h.prove(product,{available:product.availableQuantity,owned:product.owned});
  const alias=await h.request("/public/v1/short-links/"+product.shortCode);assert.equal(alias.status,200);
 }
 const hashes=report.transactions.map(t=>t.transactionHash);
 const [writes]=await h.db.query("SELECT status,serialized_transaction FROM chain_write_operations WHERE transaction_hash IN (?)",[hashes]);
 assert.equal(writes.length,9);assert.ok(writes.every(w=>w.status==="CONFIRMED"&&w.serialized_transaction===null));
 for(const job of report.jobs)for(const item of job.items){
  const receipt=await h.client.getTransactionReceipt({hash:item.result.transactionHash});assert.equal(receipt.status,"success");
  if(item.action==="create")continue; // Registration hashes are verified by prove().
  const [rows]=await h.db.query("SELECT request_json FROM chain_write_operations WHERE operation_id=?",[item.result.operationId]);
  const write=typeof rows[0].request_json==="string"?JSON.parse(rows[0].request_json):rows[0].request_json;
  const hash=write.args.at(-1),[documents]=await h.db.query("SELECT raw_text FROM offchain_documents WHERE content_hash=?",[hash]);
  assert.equal(documents.length,1);assert.equal(keccak256(stringToHex(documents[0].raw_text)),hash);
  const doc=JSON.parse(documents[0].raw_text);assert.equal(doc.integration.operationId,item.operationId);
  assert.equal(doc.integration.reference,job.reference);assert.equal(doc.integration.occurredAt,job.occurredAt);
  const names=item.action==="remove"?["QuantityRemoved"]:["BatchReceived","CustodyClaimed"];
  const events=receipt.logs.filter(log=>log.address.toLowerCase()===h.address).flatMap(log=>{try{return [decodeEventLog({abi:h.abi,topics:log.topics,data:log.data})];}catch{return [];}});
  assert.ok(events.some(event=>names.includes(event.eventName)&&event.args.evidenceHash===hash));
 }
 const [items]=await h.db.query("SELECT status FROM erp_operations WHERE operation_id IN (?)",[report.jobs.flatMap(j=>j.items.map(i=>i.operationId))]);
 assert.equal(items.length,9);assert.ok(items.every(i=>i.status==="CONFIRMED"));
 console.log(JSON.stringify({passed:true,products:3,jobs:3,erpConfirmedTransactions:9,evidenceHashesVerified:6,contract:h.address},null,2));
}finally{await h.db.end();}
