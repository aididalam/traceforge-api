const apiDist=process.env.TRACEFORGE_TEST_API_DIST??"dist";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Fastify from "fastify";

// All model/profile/event tables are connection-local TEMPORARY shadows.
// Publication rows remain UNCOMMITTED and are rolled back on disconnect.
// No live schema, entity, document, token or blockchain write is changed.
process.env.TRACEFORGE_BROADCAST_ENABLED = "false";
const { db } = await import("../"+apiDist+"/db.js");
const { config } = await import("../"+apiDist+"/config.js");
const { registerPublicDiscoveryRoutes } = await import("../"+apiDist+"/routes/public-discovery.js");
const { savePublicPresentation } = await import("../"+apiDist+"/public-presentation.js");
assert.equal(config.traceforge.broadcastEnabled, false);
const connection = await db.getConnection();
const query = async (sql, values = []) => (await connection.query(sql, values))[0];
const counts = async () => (await db.query(`SELECT (SELECT COUNT(*) FROM entities) AS entities,
  (SELECT COUNT(*) FROM chain_events) AS events, (SELECT COUNT(*) FROM public_entity_publications) AS publications,
  (SELECT COUNT(*) FROM offchain_documents) AS documents, (SELECT COUNT(*) FROM chain_write_operations) AS operations`))[0][0];
const before = await counts();
const migrationsBefore = (await db.query("SELECT migration_name FROM api_schema_migrations ORDER BY migration_name"))[0];
const h = byte => "0x" + byte.repeat(32);
const tenant = h("ac"), entity = h("dc"), linked = h("de"), hash = h("45");
const producer = { id: h("13"), metadataHash: h("67"), name: "Demo Producer", type: "Producer" };
const distributor = { id: h("24"), metadataHash: h("78"), name: "Demo Distributor", type: "Distributor" };
const product = { name: "Demo Batch", description: null, fields: [{ label: "Units", value: "100" }] };
const sentinel = "SYNTHETIC_PRIVATE_DOCUMENT";
const app = Fastify({ logger: false });
try {
  for (const table of ["entities", "organizations", "tenant_memberships", "chain_events", "product_quantities"]) {
    const [schema] = await query(`SHOW CREATE TABLE ${table}`);
    await query(schema["Create Table"].replace(/^CREATE TABLE/, "CREATE TEMPORARY TABLE"));
  }
  // The production query uses a correlated raw-log lookup. MySQL TEMPORARY
  // tables need a second physical mirror for that alias in this isolated test.
  const [eventSchema] = await query("SHOW CREATE TABLE chain_events");
  await query(eventSchema["Create Table"].replace("`chain_events`","`presentation_test_companion_events`"));
  await query(eventSchema["Create Table"].replace("`chain_events`","`presentation_test_registration_events`"));
  await query(eventSchema["Create Table"].replace("`chain_events`","`presentation_test_movement_events`"));
  await query(readFileSync("migrations/006_public_entity_presentations.sql", "utf8").replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMPORARY TABLE"));
  await connection.beginTransaction();
  for (const id of [entity, linked]) {
    await query(`INSERT INTO entities (tenant_id,entity_id,entity_type,metadata_hash,current_state,current_custodian,closed,created_at,closed_at,created_event_id,updated_event_id)
      VALUES (?,?,?,?,?,?,FALSE,'1790000000',NULL,1,1)`, [tenant, id, hash, hash, hash, distributor.id]);
    assert.equal((await query("SELECT entity_id FROM public_entity_publications WHERE tenant_id=? AND entity_id=?", [tenant, id])).length, 0,
      "Refuse to alter an existing publication");
    await query("INSERT INTO public_entity_publications (tenant_id,entity_id) VALUES (?,?)", [tenant,id]);
  }
  for (const org of [producer, distributor]) {
    await query("INSERT INTO organizations (organization_id,metadata_hash,active,created_at,created_event_id,updated_event_id) VALUES (?,?,TRUE,1790000000,1,1)", [org.id,org.metadataHash]);
    await query("INSERT INTO tenant_memberships (tenant_id,organization_id,active,joined_at,joined_event_id,updated_event_id) VALUES (?,?,TRUE,1790000000,1,1)", [tenant,org.id]);
  }
  const profile={ metadataHash:hash,productInfo:product,organizations:[producer,distributor] };
  await savePublicPresentation(connection,tenant,entity,profile);
  await savePublicPresentation(connection,tenant,entity,profile);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM public_entity_presentations"))[0].count),1,"Sharing details must be idempotent");
  await assert.rejects(savePublicPresentation(connection,tenant,entity,{...profile,metadataHash:h("56")}),/reference has changed/);
  await assert.rejects(savePublicPresentation(connection,tenant,entity,{...profile,organizations:[{...producer,metadataHash:h("89")}]}),/Business reference/);
  await assert.rejects(savePublicPresentation(connection,h("ef"),entity,profile),/Publish the indexed product/);
  const kinds = [
    ["EntityCreated","createdAt"], ["TraceRecorded","timestamp"], ["CustodyClaimed","timestamp"],
    ["EntityLinkCreated","createdAt"], ["EntityLinkStatusChanged","updatedAt"], ["EntityClosed","closedAt"],
  ];
  for (let i=0; i<kinds.length; i++) {
    const [kind,key] = kinds[i];
    const args = { tenantId: tenant, entityId: entity, [key]: String(1790000000+i*60), organizationId: producer.id,
      entityType: hash, initialState: hash, stateAfter: hash, metadataHash: hash, metadataHashAfter: hash,
      evidenceHash: hash, eventType: hash, private: sentinel, actor: "0x"+"99".repeat(20) };
    if (kind.startsWith("Custody")) {
      delete args.organizationId;
      args.fromOrganizationId=producer.id; args.toOrganizationId=distributor.id;
    }
    if (kind.startsWith("EntityLink")) { delete args.entityId; args.sourceEntityId=entity; args.targetEntityId=linked; args.linkType=hash; }
    await query(`INSERT INTO chain_events (id,chain_id,contract_address,block_number,block_hash,transaction_hash,transaction_index,log_index,topics,data,event_name,event_args)
      VALUES (?,?,?,?,?,?,0,0,'[]','0x',?,?)`,
      [String(9007199254740993n+BigInt(i)),config.traceforge.chainId,config.traceforge.contractAddress,100+i,hash,h(String(i+1).padStart(2,"0")),kind,JSON.stringify(args)]);
  }
  const historyQuery=async(sql,args=[])=>{
    if(sql.includes("FROM chain_events companion")){
      await query("DELETE FROM presentation_test_companion_events");
      await query("INSERT INTO presentation_test_companion_events SELECT * FROM chain_events");
      await query("DELETE FROM presentation_test_registration_events");
      await query("INSERT INTO presentation_test_registration_events SELECT * FROM chain_events");
      await query("DELETE FROM presentation_test_movement_events");
      await query("INSERT INTO presentation_test_movement_events SELECT * FROM chain_events");
    }
    return connection.query(sql.replace("FROM chain_events companion","FROM presentation_test_companion_events companion").replace("FROM chain_events registration","FROM presentation_test_registration_events registration").replace("FROM chain_events movement","FROM presentation_test_movement_events movement"),args);
  };
  await registerPublicDiscoveryRoutes(app, { db: { query: historyQuery },
    chainId: config.traceforge.chainId, contractAddress: config.traceforge.contractAddress });
  const path=`/public/v1/tenants/${tenant}/entities/${entity}`;
  const response=await app.inject(path+"/history");
  assert.equal(response.statusCode,200);
  const body=response.json();
  assert.deepEqual(body.entity.productInfo,product);
  assert.equal(body.entity.currentHolder.name,distributor.name);
  assert.equal(body.events.length,kinds.length);
  for (let i=0;i<kinds.length;i++) assert.equal(body.events[i].occurredAt,String(1790000000+i*60),kinds[i][0]+" timestamp extraction failed");
  assert.equal(body.events[2].organization.name,distributor.name,"Receipt must be attributed to the receiver");
  assert.deepEqual(body.events[2].transfer, { from:{ id:producer.id,name:producer.name,type:producer.type },to:{ id:distributor.id,name:distributor.name,type:distributor.type } });
  assert.ok(!response.body.includes(sentinel));
  assert.ok(!response.body.includes("0x"+"99".repeat(20)));
  const first=(await app.inject(path+"/history?limit=3")).json();
  assert.equal(first.page.nextAfterEventId,"9007199254740995");
  const next=(await app.inject(path+"/history?limit=3&afterEventId="+first.page.nextAfterEventId)).json();
  assert.equal(next.events[0].eventName,"EntityLinkCreated");
  const receipt={tenantId:tenant,entityId:entity,eventType:hash,evidenceHash:hash,actor:"0x"+"99".repeat(20),fromOrganizationId:producer.id,toOrganizationId:distributor.id,timestamp:"1790000500"};
  const trace={...receipt,organizationId:distributor.id};
  const removal={...trace,closedAt:"1790000560"};
  const base=9007199254741100n;
  const fixtures=[
    ["CustodyClaimed",0,receipt], ["TraceRecorded",1,trace],
    ["TraceRecorded",2,trace], // a separate trace in the very same transaction
    ["EntityClosed",3,removal], ["TraceRecorded",4,{...removal,timestamp:removal.closedAt}],
    ["EntityClosed",5,removal], ["TraceRecorded",6,{...removal,timestamp:removal.closedAt,evidenceHash:h("aa")}],
    ["CustodyClaimed",7,receipt], ["TraceRecorded",8,{...trace,actor:"0x"+"88".repeat(20)}],
    ["CustodyClaimed",9,receipt], ["TraceRecorded",10,{...trace,organizationId:h("35")}],
    ["CustodyClaimed",11,receipt], ["TraceRecorded",12,{...trace,timestamp:"1790000501"}],
    ["CustodyClaimed",13,receipt], ["TraceRecorded",14,{...trace,eventType:h("bb")}],
    ["CustodyClaimed",15,{...receipt,entityId:linked}], ["TraceRecorded",16,trace],
    ["CustodyClaimed",17,{...receipt,tenantId:h("bb")}], ["TraceRecorded",18,trace],
    ["CustodyClaimed",19,receipt], ["TraceRecorded",21,trace], // nonadjacent
  ];
  for(let i=0;i<fixtures.length;i++){
    const [kind,log,args]=fixtures[i];
    await query("INSERT INTO chain_events (id,chain_id,contract_address,block_number,block_hash,transaction_hash,transaction_index,log_index,topics,data,event_name,event_args) VALUES (?,?,?,?,?,?,0,?,'[]','0x',?,?)",[String(base+BigInt(i)),config.traceforge.chainId,config.traceforge.contractAddress,200,hash,h("fe"),log,kind,JSON.stringify(args)]);
  }
  const expected=fixtures.flatMap(([, ,args],i)=>[1,4,15,17].includes(i)?[]:[String(base+BigInt(i))]);
  const merged=(await app.inject(path+"/history?afterEventId="+(base-1n))).json();
  assert.deepEqual(merged.events.map(event=>event.eventId),expected,"Only exact paired logs suppressed; distinct traces survive");
  let cursor=String(base-1n),paged=[];
  for(let count=0;count<expected.length;count++){
    const response=await app.inject(path+"/history?limit=1&afterEventId="+cursor);
    assert.equal(response.statusCode,200);const result=response.json();
    assert.equal(result.events.length,1);paged.push(result.events[0].eventId);
    if(!result.page.hasMore){assert.equal(result.page.nextAfterEventId,null);break;}
    cursor=result.page.nextAfterEventId;
  }
  assert.deepEqual(paged,expected,"Filtering must occur before LIMIT, including paired logs crossing a cursor boundary");
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM chain_events"))[0].count),kinds.length+fixtures.length,"Raw audit logs preserved");
  await query("UPDATE entities SET metadata_hash=? WHERE tenant_id=? AND entity_id=?",[h("56"),tenant,entity]);
  assert.equal((await app.inject(path)).json().productInfo,null,"Stale product details exposed");
  await query("UPDATE organizations SET metadata_hash=? WHERE organization_id=?",[h("89"),distributor.id]);
  assert.equal((await app.inject(path)).json().currentHolder.name,null,"Stale business name exposed");
  await query("DELETE FROM tenant_memberships WHERE tenant_id=? AND organization_id=?",[tenant,producer.id]);
  assert.equal((await app.inject(path+"/history")).json().events[0].organization.name,producer.name,"A verified public business profile must remain visible across workspaces");
  await query("DELETE FROM public_entity_publications WHERE tenant_id=? AND entity_id=?",[tenant,entity]);
  const hidden=await app.inject(path);
  const missing=await app.inject(path.replace(entity,h("ef")));
  assert.equal(hidden.statusCode,404); assert.deepEqual(hidden.json(),missing.json());
  assert.equal((await app.inject(path+"/history")).statusCode,404);
  await assert.rejects(savePublicPresentation(connection,tenant,entity,profile),/Publish the indexed product/);
  await savePublicPresentation(connection,tenant,entity,null);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM public_entity_presentations"))[0].count),0);
  assert.deepEqual(await counts(),before,"Committed live data changed");
  console.log("Public presentation MySQL checks passed: all event dates, paired-log suppression with independent traces preserved, exact cursor boundaries, correct transfer attribution, public product/name snapshots, stale and cross-workspace suppression, exact pagination and publication revocation.");
} finally {
  try { await app.close(); await connection.rollback(); }
  finally {
    connection.destroy();
    try {
      assert.deepEqual(await counts(),before,"Live counts changed after cleanup");
      assert.deepEqual((await db.query("SELECT migration_name FROM api_schema_migrations ORDER BY migration_name"))[0],migrationsBefore,"Live migration state changed");
    } finally { await db.end(); }
  }
}
