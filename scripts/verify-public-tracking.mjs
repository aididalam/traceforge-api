import assert from "node:assert/strict";
import {sourceUrl} from "./test-source-loader.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";

const load = source => import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
const issuerText = readFileSync("src/public-tracking.ts", "utf8");
const routeText = readFileSync("src/routes/public-tracking.ts", "utf8");
const serverText = readFileSync("src/server.ts", "utf8");
const { issuePublicTrackingId, newPublicTrackingId } = await load(issuerText);
const { registerPublicTrackingRoutes } = await load(routeText);
const tenant = "0x" + "ab".repeat(32), otherTenant = "0x" + "12".repeat(32);
const entity = "0x" + "cd".repeat(32), idA = "0x" + "34".repeat(32), idB = "0x" + "56".repeat(32), unknown = "0x" + "ef".repeat(32);
const key = (t, e) => t + "/" + e;
const pairs = new Set([key(tenant, entity), key(otherTenant, entity)]);
const publications = new Set(pairs), registry = new Map();
let calls = 0, failure = null, race = false;
const eligible = row => row && pairs.has(key(row.tenant_id, row.entity_id)) && publications.has(key(row.tenant_id, row.entity_id));
const db = { async query(sql, values) {
  calls++;
  if (failure) throw failure;
  assert.match(sql, /JOIN public_entity_publications|FROM public_entity_publications/);
  assert.match(sql, /JOIN entities/);
  assert.doesNotMatch(sql, /SELECT\s+\*|document_json|offchain_documents/i);
  if (sql.includes("INSERT INTO")) {
    const [id, t, e] = values;
    if (!publications.has(key(t, e)) || !pairs.has(key(t, e))) return [{ affectedRows: 0 }];
    if (race) { registry.set(idB, { tracking_id: idB, tenant_id: t, entity_id: e }); race = false; }
    if (registry.has(id) || [...registry.values()].some(row => key(row.tenant_id, row.entity_id) === key(t, e))) {
      throw Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), { code: "ER_DUP_ENTRY" });
    }
    registry.set(id, { tracking_id: id, tenant_id: t, entity_id: e });
    return [{ affectedRows: 1 }];
  }
  const row = values.length === 1 ? registry.get(values[0]) : [...registry.values()].find(row => key(row.tenant_id, row.entity_id) === key(...values));
  return [eligible(row) ? [{ ...row, private_document: "SYNTHETIC_PRIVATE_SENTINEL" }] : []];
} };

assert.equal(await issuePublicTrackingId(db, tenant, entity, () => idA), idA);
assert.equal(await issuePublicTrackingId(db, "0x" + tenant.slice(2).toUpperCase(), entity, () => { throw Error("Should reuse ID"); }), idA);
let attempt = 0;
assert.equal(await issuePublicTrackingId(db, otherTenant, entity, () => ++attempt === 1 ? idA : idB), idB);
assert.equal(attempt, 2, "Collision must regenerate rather than overwrite");
assert.equal(registry.get(idA).tenant_id, tenant);
assert.equal(registry.size, 2, "Same entity ID across tenants gets separate global IDs");
const beforeInvalid = calls;
await assert.rejects(issuePublicTrackingId(db, "bad", entity), /bytes32/);
assert.equal(calls, beforeInvalid);
await assert.rejects(issuePublicTrackingId(db, tenant, unknown), /explicitly published/);
publications.delete(key(tenant, entity));
await assert.rejects(issuePublicTrackingId(db, tenant, entity), /explicitly published/);

const rateOptions = serverText.match(/await app\.register\(\s*rateLimit,\s*([\s\S]*?)\n\);/)?.[1].replace(/,\s*$/, "");
const errorHandler = serverText.match(/app\.setErrorHandler\(\s*([\s\S]*?)\n\);/)?.[1].replace(/,\s*$/, "");
const apiError = serverText.match(/function apiError\([\s\S]*?\n\}/)?.[0];
assert.ok(rateOptions && errorHandler && apiError);
const perimeter = await load(`import {proxyClient} from ${JSON.stringify(sourceUrl('src/proxy-client.ts'))};\nconst config={proxyKey:'Synthetic-Proxy-Key'};\n${apiError}\nexport const options = ${rateOptions};\nexport const handler = ${errorHandler};`);
assert.match(serverText, /await registerPublicTrackingRoutes\(app, \{ db \}\)/);
assert.doesNotMatch(routeText, /readFile|signer|writeContract|sendRawTransaction|\.post\(/);
const app = Fastify({ logger: false });
app.setErrorHandler(perimeter.handler);
await app.register(swagger, { openapi: { info: { title: "Tracking verification", version: "1" } } });
await registerPublicTrackingRoutes(app, { db });
await app.ready();
const path = id => "/public/v1/tracking/" + id;
try {
  const hidden = await app.inject(path(idA));
  const missing = await app.inject(path(unknown));
  assert.equal(hidden.statusCode, 404);
  assert.deepEqual(hidden.json(), missing.json());
  assert.ok(!hidden.body.includes(tenant));
  publications.add(key(tenant, entity));
  assert.equal(await issuePublicTrackingId(db, tenant, entity), idA, "Republishing must retain the same ID");
  for (const [id, t] of [[idA, tenant], [idB, otherTenant]]) {
    const result = await app.inject(path(id));
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.deepEqual(result.json(), { trackingId: id, tenantId: t, entityId: entity });
    assert.ok(!result.body.includes("SYNTHETIC_PRIVATE_SENTINEL"));
  }
  assert.equal((await app.inject(path("0x" + idA.slice(2).toUpperCase()))).statusCode, 200);
  pairs.delete(key(tenant, entity));
  assert.deepEqual((await app.inject(path(idA))).json(), missing.json(), "Dangling mapping must not leak identity");
  pairs.add(key(tenant, entity));
  const before = calls;
  for (const url of [path("bad"), path(idA) + "?token=synthetic", path(idA) + "?limit=50"]) assert.equal((await app.inject(url)).statusCode, 400);
  assert.equal(calls, before, "Invalid IDs/queries must not access DB");
  assert.equal((await app.inject({ method: "POST", url: path(idA) })).statusCode, 404);
  assert.deepEqual(app.swagger().paths["/public/v1/tracking/{trackingId}"].get.security, []);
  failure = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), { code: "ER_NO_SUCH_TABLE" });
  const unavailable = await app.inject(path(idA));
  assert.equal(unavailable.statusCode, 503);
  assert.ok(!unavailable.body.includes("SYNTHETIC_PRIVATE_SQL"));
  failure = null;
} finally { await app.close(); }

const limited = Fastify({ logger: false });
limited.setErrorHandler(perimeter.handler);
await limited.register(rateLimit, { ...perimeter.options, max: 2 });
await registerPublicTrackingRoutes(limited, { db });
limited.get("/v1/probe", async () => ({}));
try {
  assert.equal((await limited.inject(path(idA))).statusCode, 200);
  assert.equal((await limited.inject("/v1/probe")).statusCode, 200);
  const blocked = await limited.inject({ url: path(idB).replace("public", "%70ublic"), headers: { "x-forwarded-for": "192.0.2.9" } });
  assert.equal(blocked.statusCode, 429, "Encoded public path must share operator budget; spoofed IP must not bypass it");
} finally { await limited.close(); }

registry.delete(idB);
race = true;
assert.equal(await issuePublicTrackingId(db, otherTenant, entity, () => unknown), idB, "Concurrent issuance must return the winner's stable ID");
registry.delete(idB);
let exhausted = 0;
await assert.rejects(issuePublicTrackingId(db, otherTenant, entity, () => { exhausted++; return idA; }), /retry later/);
assert.equal(exhausted, 8);
await assert.rejects(issuePublicTrackingId(db, otherTenant, entity, () => "bad"), /generator/);
const randomIds = Array.from({ length: 50 }, newPublicTrackingId);
assert.equal(new Set(randomIds).size, 50);
for (const id of randomIds) assert.match(id, /^0x[0-9a-f]{64}$/);

const cliSource = readFileSync("src/issue-public-tracking-id.ts", "utf8")
  .replace(/import \{ db \} from "\.\/db\.js";/, "const db = { async end() {} };")
  .replace(/import \{ issuePublicTrackingId \} from "\.\/public-tracking\.js";/, 'const issuePublicTrackingId = () => { throw Error("UNEXPECTED_DB_ACCESS"); };');
for (const [args, expected] of [
  [[], "exactly once"], [["--tenant", tenant], "exactly once"],
  [["--tenant", tenant, "--tenant", entity], "exactly once"],
  [["--tenant", "bad", "--entity", entity], "bytes32"],
]) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", "process.argv.splice(1, 0, 'offline-cli');\n" + stripTypeScriptTypes(cliSource), "--", ...args], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(expected));
  assert.ok(!result.stderr.includes("UNEXPECTED_DB_ACCESS"));
}
for (const [thrower, expected] of [
  ['throw Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), { code: "ER_NO_SUCH_TABLE" });', "Apply migration 005"],
  ['throw new Error("SYNTHETIC_PRIVATE_SQL");', "Public tracking ID issuance failed."],
]) {
  const source = cliSource.replace('throw Error("UNEXPECTED_DB_ACCESS");', thrower);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", "process.argv.splice(1, 0, 'offline-cli');\n" + stripTypeScriptTypes(source), "--", "--tenant", tenant, "--entity", entity], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(expected));
  assert.ok(!result.stderr.includes("SYNTHETIC_PRIVATE_SQL"));
}
const migration = readFileSync("migrations/005_public_entity_tracking_ids.sql", "utf8");
assert.match(migration, /tracking_id BINARY\(32\) NOT NULL/);
assert.match(migration, /PRIMARY KEY \(tracking_id\)/);
assert.match(migration, /UNIQUE KEY public_tracking_entity \(tenant_id, entity_id\)/);
assert.equal(createHash("sha256").update(readFileSync("migrations/004_public_entity_publications.sql")).digest("hex"), "afcbb6d47526107219c94bfb5784f3dec57cf8d4b9891701ffff23e96f65f542");
console.log("Public tracking verified offline: namespace isolation, stable issuance/collision/race handling, publication gating, privacy, validation, perimeter and CLI.");
