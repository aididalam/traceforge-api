import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE="http://127.0.0.1:3000";
const TENANT="0x99fcc8dda979ffa767f086d31e451e8f244ecdf1334f5af2af4f6b397aff30e2";
const CLOSED="0xb6a021b5def89a8029c720c6418d60bdaf595d2ef2c1d0d4bab7f521d2bdc834";
const OPEN="0x098dec8d5207ed3dd8a04fd03193c758c650884d39f9d471e6d95336c4a1a569";
const ITEM="0xd74416be5a0f22763f73a0a923d9377b0b124062ba89b1de75e6f905f7cb0836";
const META="0x76d88f47c0e4e2fa6182c02744727ffb05232a8f00ead1ec1d024c8e7489d36c";
const CREATED="0x09ddea8cc7bb8763f501e1101b83d1f724d14016aa7cdef5f09ab85743ee0fad";
const PACKED="0xf88c6ab7a280e131d28760ae11d8d1b190884b6be85e6222a4d6a37486326540";
const ALT_META="0xfbab6097420bf6b760926aa5c1e0806211ab26e164be66029611bdb652665368";
const CONTAINS="0xb546ddebf2cc54c215beee5b56c25b19cd4e03d9ef5628d869b5a8528fc95d01";
const CLOSE_EVT="0xc9fcf803d594828bb1179c6afe1670b98b444f1fdd4d84ca3c38491117242c30";
const CLOSE_EVD="0x70c485d01a9f96eb21097b7ee53037c078b3c1ffd1942e38bb1e9af4fb6bf774";
const LINK_EVT="0xc30cecb4c51e0baf220d05515ad5b0b8e5049f5bd35d377374e6a173b543dda0";
const LINK_EVD="0x6d3f3c850f5ca67b8b48e627752ead21aedb4705c6bc8a874063e19529245eef";
const STATUS_EVT="0x2ac97c8f9dbd65406f6acbb5f8c85f4aed4a0a0055b4a484e14604484020de90";
const STATUS_EVD="0x8080fc0edbdba2492f513dc8e62495fdc7d2ef87a0d00cbe3a3184ca6c3f6fa0";

const secret=(name)=>readFileSync(join(homedir(),".traceforge","secrets",name),"utf8").trim();
const WRITER=secret("api-sandbox-producer-writer.token");
const READER=secret("api-sandbox.token");

async function req(path,token,method="GET",body){
  const r=await fetch(BASE+path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:JSON.parse(await r.text())};
}
const hasKey=(v,k)=>v&&typeof v==="object"&&(Object.hasOwn(v,k)||Object.values(v).some(x=>hasKey(x,k)));

async function entity(){
  const r=await req(`/v1/tenants/${TENANT}/entities/${CLOSED}`,READER);
  assert.equal(r.status,200);
  assert.equal(r.data.closed,true);
  assert.ok(r.data.closedAt);
  return r.data;
}

const tests=[
["create",`/v1/tenants/${TENANT}/entities/${CLOSED}/create/simulate`,{entityType:ITEM,metadataHash:META,initialState:CREATED},"entity_absent"],
["trace",`/v1/tenants/${TENANT}/entities/${CLOSED}/traces/simulate`,{eventType:CLOSE_EVT,evidenceHash:CLOSE_EVD},"entity_open"],
["state",`/v1/tenants/${TENANT}/entities/${CLOSED}/state/simulate`,{eventType:CLOSE_EVT,newState:PACKED,evidenceHash:CLOSE_EVD},"entity_open"],
["metadata",`/v1/tenants/${TENANT}/entities/${CLOSED}/metadata/simulate`,{eventType:CLOSE_EVT,newMetadataHash:ALT_META,evidenceHash:CLOSE_EVD},"entity_open"],
["link-create",`/v1/tenants/${TENANT}/entities/${CLOSED}/links/simulate`,{targetEntityId:OPEN,linkType:CONTAINS,eventType:LINK_EVT,evidenceHash:LINK_EVD},"entity_open"],
["link-status",`/v1/tenants/${TENANT}/entities/${OPEN}/links/status/simulate`,{targetEntityId:CLOSED,linkType:CONTAINS,active:true,eventType:STATUS_EVT,evidenceHash:STATUS_EVD},"target_entity_open"],
["close",`/v1/tenants/${TENANT}/entities/${CLOSED}/close/simulate`,{eventType:CLOSE_EVT,evidenceHash:CLOSE_EVD},"entity_open"],
];

const before=await entity();
for(const [name,path,body,failed] of tests){
  const r=await req(path,WRITER,"POST",body);
  assert.equal(r.status,409,`${name}: HTTP`);
  assert.equal(r.data.simulated,false,`${name}: simulated`);
  assert.equal(r.data.error?.code,"preflight_failed",`${name}: error`);
  const checks=new Map((r.data.checks??[]).map(c=>[c.name,c]));
  assert.equal(checks.get(failed)?.ok,false,`${name}: ${failed}`);
  assert.equal(hasKey(r.data,"transactionHash"),false,`${name}: transactionHash`);
  console.log(`PASS ${name} -> ${failed}`);
}
const after=await entity();
for(const f of ["entityId","metadataHash","currentState","currentCustodian","closed","createdAt","closedAt"]) assert.deepEqual(after[f],before[f],`changed: ${f}`);

console.log("\nGENERIC TERMINAL GUARD MATRIX PASSED: 7/7");
console.log("No simulated request produced a transaction hash.");
console.log("Closed entity read model remained unchanged.");
console.log(`closed=${after.closed} closedAt=${after.closedAt}`);
