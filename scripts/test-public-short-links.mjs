import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Fastify from "fastify";

// One connection owns temporary registry/publication/entity tables. Disconnect
// drops every test row and table. No live schema, publication or chain write.
process.env.TRACEFORGE_BROADCAST_ENABLED="false";
const {db}=await import("../dist/db.js");
const {issuePublicTrackingId}=await import("../dist/public-tracking.js");
const {issuePublicShortLink}=await import("../dist/public-short-links.js");
const {registerPublicShortLinkRoutes}=await import("../dist/routes/public-short-links.js");
const connection=await db.getConnection();
const query=async(sql,values=[])=>(await connection.query(sql,values))[0];
const liveState=async()=>({
  counts:(await db.query(`SELECT (SELECT COUNT(*) FROM entities) AS entities,
    (SELECT COUNT(*) FROM public_entity_publications) AS publications,
    (SELECT COUNT(*) FROM chain_write_operations) AS operations`))[0][0],
  registries:(await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME IN ('public_entity_tracking_ids','public_entity_short_links') ORDER BY TABLE_NAME`))[0],
  migrations:(await db.query("SELECT migration_name FROM api_schema_migrations ORDER BY migration_name"))[0],
});
const before=await liveState();
const h=byte=>"0x"+byte.repeat(32);
const tenant=h("ab"),other=h("12"),third=h("ac"),entity=h("cd");
const idA=h("34"),idB=h("56"),idC=h("78");
const codeA="0123456789ab",codeB="mnpqrstvwxyz",codeC="abcdef012345";
const bound={query:connection.query.bind(connection)},app=Fastify({logger:false});
try {
  await query("CREATE TEMPORARY TABLE entities (tenant_id VARCHAR(66) NOT NULL,entity_id VARCHAR(66) NOT NULL,PRIMARY KEY(tenant_id,entity_id))");
  for(const name of ["004_public_entity_publications.sql","005_public_entity_tracking_ids.sql","007_public_entity_short_links.sql"])
    await query(readFileSync("migrations/"+name,"utf8").replace("CREATE TABLE IF NOT EXISTS","CREATE TEMPORARY TABLE"));
  for(const [t,id] of [[tenant,idA],[other,idB],[third,idC]]) {
    await query("INSERT INTO entities (tenant_id,entity_id) VALUES (?,?)",[t,entity]);
    await query("INSERT INTO public_entity_publications (tenant_id,entity_id) VALUES (?,?)",[t,entity]);
    assert.equal(await issuePublicTrackingId(bound,t,entity,()=>id),id);
  }
  assert.equal(await issuePublicShortLink(bound,idA,()=>codeA),codeA);
  let attempts=0;
  assert.equal(await issuePublicShortLink(bound,idB,()=>++attempts===1?codeA:codeB),codeB);
  assert.equal(attempts,2,"Real code PK collision must retry");
  await assert.rejects(query("INSERT INTO public_entity_short_links (short_code,tracking_id) VALUES (?,UNHEX(SUBSTRING(?,3)))",[codeA,idC]),{code:"ER_DUP_ENTRY"});
  await assert.rejects(query("INSERT INTO public_entity_short_links (short_code,tracking_id) VALUES (?,UNHEX(SUBSTRING(?,3)))",[codeC,idA]),{code:"ER_DUP_ENTRY"});
  assert.equal(await issuePublicShortLink(bound,idA,()=>{throw Error("Must reuse");}),codeA);
  await registerPublicShortLinkRoutes(app,{db:bound});
  const path=code=>"/public/v1/short-links/"+code;
  for(const [code,id,t] of [[codeA,idA,tenant],[codeB,idB,other]]) {
    const response=await app.inject(path(code.toUpperCase()));
    assert.equal(response.statusCode,200); assert.equal(response.headers["cache-control"],"no-store");
    assert.deepEqual(response.json(),{shortCode:code,trackingId:id,tenantId:t,entityId:entity});
  }
  await query("DELETE FROM public_entity_publications WHERE tenant_id=?",[tenant]);
  const hidden=await app.inject(path(codeA)),missing=await app.inject(path(codeC));
  assert.equal(hidden.statusCode,404); assert.deepEqual(hidden.json(),missing.json());
  await assert.rejects(issuePublicShortLink(bound,idA,()=>codeC),/existing published product/);
  attempts=0;
  assert.equal(await issuePublicShortLink(bound,idC,()=>++attempts===1?codeA:codeC),codeC,"Unpublished products must retain their reserved code");
  assert.equal(attempts,2);
  await query("INSERT INTO public_entity_publications (tenant_id,entity_id) VALUES (?,?)",[tenant,entity]);
  assert.equal(await issuePublicShortLink(bound,idA,()=>{throw Error("Must reuse after republishing");}),codeA);
  await query("DELETE FROM entities WHERE tenant_id=?",[tenant]);
  assert.deepEqual((await app.inject(path(codeA))).json(),missing.json());
  await query("DELETE FROM public_entity_tracking_ids WHERE tracking_id=UNHEX(SUBSTRING(?,3))",[idB]);
  assert.deepEqual((await app.inject(path(codeB))).json(),missing.json());
  assert.equal((await query("SELECT COUNT(*) AS count FROM public_entity_short_links"))[0].count,3);
  assert.deepEqual(await liveState(),before,"Live data/schema changed during short-link test");
  console.log("Short-link MySQL checks passed: PK/one-code-per-ID constraints, collision retries, case normalization, cross-tenant IDs, retained hidden aliases, republishing and dangling-record privacy. Live state unchanged.");
} finally {
  try {await app.close();}
  finally {connection.destroy(); try {assert.deepEqual(await liveState(),before);} finally {await db.end();}}
}
