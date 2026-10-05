import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import Fastify from "fastify";
import { spawnSync } from "node:child_process";

const url = source => "data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64");
const source = readFileSync("src/public-presentation.ts", "utf8");
const moduleUrl = url(source);
const { validatePresentation, readPublicPresentation, publicTimestamp, savePublicPresentation } = await import(moduleUrl);
const routeSource = readFileSync("src/routes/public-discovery.ts", "utf8");
const { registerPublicDiscoveryRoutes } = await import(url(routeSource.replace('"../public-presentation.js"', JSON.stringify(moduleUrl))));
const h = byte => "0x" + byte.repeat(32);
const tenant = h("ab"), entity = h("cd"), hash = h("44"), otherHash = h("55");
const producer = { id: h("11"), metadataHash: h("66"), name: "Demo Producer", type: "Producer" };
const distributor = { id: h("22"), metadataHash: h("77"), name: "Demo Distributor", type: "Distributor" };
const sentinel = "SYNTHETIC_PRIVATE_DOCUMENT";
const profile = { metadataHash: hash, productInfo: { name: "Demo Batch", description: "Shared product description",
  fields: [{ label: "Units", value: "100" }] }, organizations: [producer, distributor] };
assert.deepEqual(validatePresentation(profile), profile);
for (const bad of [
  { ...profile, privateDocument: sentinel },
  { ...profile, productInfo: { ...profile.productInfo, rawDocument: sentinel } },
  { ...profile, organizations: [producer, producer] },
  { ...profile, organizations: [{ ...producer, id: "bad" }] },
  { ...profile, productInfo: { ...profile.productInfo, fields: [{ label: "Units", value: "100" }, { label: "units", value: "200" }] } },
  { ...profile, productInfo: { ...profile.productInfo, fields: [{ label: "Units", value: "x".repeat(1001) }] } },
]) assert.throws(() => validatePresentation(bad));
for (const bad of [null, "bad", "-1", "01", "18446744073709551616", 1790000000]) assert.equal(publicTimestamp(bad), null);
assert.equal(publicTimestamp("18446744073709551615"), "18446744073709551615");
let saved = null, writable = true, productHash = hash, orgHash = distributor.metadataHash;
const writer = { async query(sql, values) {
  assert.doesNotMatch(sql, /offchain_documents|document_json|actor|wallet/i);
  if (sql.startsWith("SELECT e.metadata_hash")) {
    assert.match(sql, /FOR UPDATE/); assert.deepEqual(values,[tenant,entity]);
    return [writable ? [{metadata_hash:productHash}] : []];
  }
  if (sql.startsWith("SELECT o.metadata_hash")) {
    assert.match(sql,/o\.organization_id=\?/); assert.doesNotMatch(sql,/tenant_memberships/);
    return [[{metadata_hash:values[0]===producer.id ? producer.metadataHash : orgHash}]];
  }
  if (sql.includes("INSERT INTO public_entity_presentations")) {
    assert.deepEqual(values,[tenant,entity,hash,JSON.stringify(profile.productInfo),JSON.stringify(profile.organizations)]);
    saved=values; return [{affectedRows:1}];
  }
  assert.match(sql,/^DELETE FROM public_entity_presentations/); assert.deepEqual(values,[tenant,entity]);
  saved=null; return [{affectedRows:1}];
} };
await savePublicPresentation(writer,tenant,entity,profile);
assert.ok(saved);
productHash=otherHash;
await assert.rejects(savePublicPresentation(writer,tenant,entity,profile),/reference has changed/);
productHash=hash; orgHash=otherHash;
await assert.rejects(savePublicPresentation(writer,tenant,entity,profile),/Business reference/);
orgHash=distributor.metadataHash; writable=false;
await assert.rejects(savePublicPresentation(writer,tenant,entity,profile),/Publish the indexed product/);
assert.ok(saved,"Rejected writes must preserve the earlier snapshot");
await savePublicPresentation(writer,tenant,entity,null); assert.equal(saved,null);
let published = true, staleProduct = false, staleOrganization = false, missingTable = false, brokenProfile = false;
let presentationQueries = 0;
const db = { async query(sql, values) {
  assert.doesNotMatch(sql, /SELECT\s+\*|offchain_documents|document_json|actor|wallet/i);
  if (sql.includes("FROM public_entity_publications p")) return [[...(published && values.at(-2) === tenant && values.at(-1) === entity ? [{
    tenant_id: tenant, entity_id: entity, entity_type: hash, entity_type_label: "Batch", metadata_hash: staleProduct ? otherHash : hash,
    current_state: hash, current_state_label: "Packed", current_custodian: distributor.id, closed: 0, created_at: "1790000000", closed_at: null,
    private_document: sentinel,
  }] : [])]];
  if (sql.includes("FROM public_entity_presentations")) {
    presentationQueries++;
    assert.deepEqual(values, [tenant, entity]);
    if (missingTable) throw Object.assign(new Error(sentinel), { code: "ER_NO_SUCH_TABLE" });
    return [[{ metadata_hash: hash, product_info: brokenProfile ? { private: sentinel } : profile.productInfo, organization_profiles: profile.organizations }]];
  }
  if (sql.includes("FROM organizations o")) {
    assert.doesNotMatch(sql,/tenant_memberships/);
    assert.deepEqual(values, [producer.id, distributor.id]);
    return [[{ organization_id: producer.id, metadata_hash: producer.metadataHash },
      { organization_id: distributor.id, metadata_hash: staleOrganization ? otherHash : distributor.metadataHash }]];
  }
  assert.match(sql, /JOIN public_entity_publications p/);
  assert.match(sql, /WHEN 'CustodyClaimed'.*timestamp/);
  return [[{ id: "9007199254740993", event_name: "CustodyClaimed", block_number: "123", transaction_hash: hash,
    transaction_index: 0, log_index: 0, event_type: hash, event_type_label: "Product received", state_after: null,
    state_after_label: null, link_type: null, link_type_label: null, metadata_hash: null, evidence_hash: hash,
    occurred_at: "1790000060", organization_id: distributor.id, from_organization_id: producer.id, to_organization_id: distributor.id,
    event_args: { private: sentinel, actor: "0x" + "99".repeat(20) },
  }]];
} };
const app = Fastify({ logger: false });
await registerPublicDiscoveryRoutes(app, { db, chainId: 9009, contractAddress: "0x" + "55".repeat(20) });
const path = `/public/v1/tenants/${tenant}/entities/${entity}`;
try {
  const result = await app.inject(path + "/history");
  assert.equal(result.statusCode, 200);
  const body = result.json();
  assert.deepEqual(body.entity.productInfo, profile.productInfo);
  assert.deepEqual(body.entity.currentHolder, { id: distributor.id, name: distributor.name, type: distributor.type });
  assert.equal(body.events[0].occurredAt, "1790000060");
  assert.equal(body.events[0].organization.name, distributor.name);
  assert.equal(body.events[0].transfer.from.name, producer.name);
  assert.equal(body.events[0].transfer.to.name, distributor.name);
  assert.ok(!result.body.includes(sentinel));
  assert.ok(!result.body.includes("0x" + "99".repeat(20)));
  staleProduct = true;
  assert.equal((await app.inject(path)).json().productInfo, null);
  staleProduct = false; staleOrganization = true;
  assert.equal((await app.inject(path)).json().currentHolder.name, null);
  staleOrganization = false; brokenProfile = true;
  assert.equal((await app.inject(path)).json().productInfo, null);
  brokenProfile = false; missingTable = true;
  const compatible = (await app.inject(path + "/history")).json();
  assert.equal(compatible.entity.productInfo, null);
  assert.equal(compatible.events[0].occurredAt, "1790000060");
  assert.equal(compatible.entity.currentHolder.name, null);
  missingTable = false; published = false;
  const before = presentationQueries;
  const hidden = await app.inject(path);
  const missing = await app.inject(path.replace(entity, h("ef")));
  assert.equal(hidden.statusCode, 404);
  assert.deepEqual(hidden.json(), missing.json());
  assert.equal((await app.inject(path + "/history")).statusCode, 404);
  assert.equal(presentationQueries, before, "Unpublished products must not resolve display details");
  assert.equal((await app.inject(path.replace(tenant, h("12")))).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: path })).statusCode, 404);
  await assert.rejects(readPublicPresentation({ query() { throw Object.assign(new Error(sentinel), { code: "ER_ACCESS_DENIED_ERROR" }); } }, tenant, entity, hash));
} finally { await app.close(); }
const dummyEnv = { ...process.env, DOTENV_CONFIG_PATH:"/dev/null",TRACEFORGE_CHAIN_ID:"9009",
  TRACEFORGE_CONTRACT_ADDRESS:"0x"+"55".repeat(20),TRACEFORGE_BROADCAST_ENABLED:"false",
  MYSQL_HOST:"127.0.0.1",MYSQL_PORT:"1",MYSQL_DATABASE:"unused_public_test",MYSQL_USER:"unused_public_test",MYSQL_PASSWORD:"unused_test_value" };
const ids=["--tenant",tenant,"--entity",entity];
for (const args of [ids,[...ids,"--clear","--confirm-public"],[...ids,"--file"],
  [...ids,"--file","/unopened-synthetic-public-profile"],[...ids,"--clear","--tenant",tenant],
  ["--tenant","bad","--entity",entity,"--clear"]]) {
  const result=spawnSync(process.execPath,["--import","tsx","src/set-public-details.ts",...args],{env:dummyEnv,encoding:"utf8",timeout:10000});
  assert.equal(result.error,undefined); assert.notEqual(result.status,0);
  assert.ok((result.stdout+result.stderr).includes("Public details were not changed."));
}
console.log("Public presentation offline checks passed: explicit display fields, dated transfers, approved business names, stale-reference suppression, publication isolation and private document/wallet redaction.");
