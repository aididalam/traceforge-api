import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";

// Exercise the real route module and perimeter configuration without MySQL,
// credentials, RPC, or a running API. Production SQL is covered by the opt-in
// integration test, which only changes temporary publication rows.
async function loadSource(source) {
  const code = stripTypeScriptTypes(source);
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

const serverText = readFileSync("src/server.ts", "utf8");
// These registrations end at an unindented closing line in server.ts. Fail if
// that structure changes rather than silently testing substitute configuration.
const rateOptions = serverText.match(/await app\.register\(\s*rateLimit,\s*([\s\S]*?)\n\);/)?.[1].replace(/,\s*$/, "");
const errorHandler = serverText.match(/app\.setErrorHandler\(\s*([\s\S]*?)\n\);/)?.[1].replace(/,\s*$/, "");
const apiError = serverText.match(/function apiError\([\s\S]*?\n\}/)?.[0];
assert.ok(rateOptions && errorHandler && apiError, "Missing perimeter configuration");
const perimeter = await loadSource(`${apiError}\nexport const options = ${rateOptions};\nexport const handler = ${errorHandler};`);
assert.equal(perimeter.options.max, 120);
assert.equal(perimeter.options.timeWindow, "1 minute");
for (const url of ["/public/v1/example", "/v1/example"]) assert.equal(perimeter.options.allowList({ url, routeOptions: {} }), false);
for (const url of ["/health", "/ready", "/docs", "/openapi.json"]) assert.equal(perimeter.options.allowList({ url, routeOptions: {} }), true);
assert.doesNotMatch(serverText, /trustProxy\s*:\s*true/);
assert.match(serverText, /await registerPublicDiscoveryRoutes\(app,\s*\{/);
const authText = readFileSync("src/auth.ts", "utf8");
// Load the actual auth hook with only its configuration/DB imports replaced.
// Missing-credential probes must never reach the database or a real token file.
const isolatedAuth = authText
  .replace(/import\s*\{\s*config,?\s*\}\s*from "\.\/config\.js";/, "const config = {};")
  .replace(/import\s*\{\s*db,?\s*\}\s*from "\.\/db\.js";/, 'const db = { query() { throw new Error("Offline auth probe accessed the DB"); } };');
assert.doesNotMatch(isolatedAuth, /from "\.\//, "Auth isolation must replace all local imports");
const { authHook } = await loadSource(isolatedAuth);

const moduleText = readFileSync("src/routes/public-discovery.ts", "utf8");
assert.doesNotMatch(moduleText, /offchain_documents|document_json|readFile|signer|writeContract|sendRawTransaction|\.post\(/);
assert.doesNotMatch(moduleText, /ce\.event_args\s*,\s*ce\.block_number/);
assert.match(moduleText, /FROM public_entity_publications p/);
assert.match(moduleText, /JOIN public_entity_publications p/);
assert.match(moduleText, /source_publication/);
assert.match(moduleText, /target_publication/);
assert.match(moduleText, /CAST\(ce\.id AS CHAR\)/);
assert.match(moduleText, /ce\.id > CAST\(\? AS UNSIGNED\)/);
assert.doesNotMatch(moduleText, /OFFSET\s/i);
const { registerPublicDiscoveryRoutes } = await loadSource(moduleText);

const tenantId = "0x" + "ab".repeat(32);
const entityId = "0x" + "cd".repeat(32);
const unknownId = "0x" + "ef".repeat(32);
const hash = "0x" + "44".repeat(32);
const contractAddress = "0x" + "55".repeat(20);
const sentinel = "PRIVATE_DOCUMENT_SENTINEL";
const fixture = {
  tenant_id: tenantId, entity_id: entityId, entity_type: hash,
  entity_type_label: "Batch", metadata_hash: hash, current_state: hash,
  current_state_label: "Approved", current_custodian: hash, closed: 0,
  created_at: "1790000000", closed_at: null,
  metadata_document: { private: sentinel }, event_args: { private: sentinel },
};
const events = ["9007199254740993", "9007199254740994"].map((id, i) => ({
  id, event_name: "TraceRecorded", block_number: String(100 + i),
  transaction_hash: hash, transaction_index: 0, log_index: i,
  event_type: hash, event_type_label: "Approved", state_after: hash,
  state_after_label: "Approved", link_type: null, link_type_label: null,
  metadata_hash: hash, evidence_hash: hash, event_args: { targetEntityId: unknownId, private: sentinel },
  metadata_document: { private: sentinel }, evidence_document: { private: sentinel },
}));
let published = false;
let queryCount = 0;
const db = {
  async query(sql, values) {
    queryCount += 1;
    assert.doesNotMatch(sql, /offchain_documents|document_json|SELECT\s+\*/i);
    if (sql.includes("FROM public_entity_publications p")) {
      assert.match(sql, /JOIN entities e ON e\.tenant_id = p\.tenant_id AND e\.entity_id = p\.entity_id/);
      assert.match(sql, /WHERE p\.tenant_id = \? AND p\.entity_id = \?/);
      assert.deepEqual(values.slice(0, 4), [9009, contractAddress, 9009, contractAddress]);
      return [published && values.at(-2) === tenantId && values.at(-1) === entityId ? [fixture] : []];
    }
    assert.match(sql, /JOIN public_entity_publications p/);
    assert.match(sql, /p\.tenant_id = JSON_UNQUOTE\(JSON_EXTRACT\(ce\.event_args, '\$\.tenantId'\)\)/);
    assert.deepEqual(values.slice(0, 4), [tenantId, entityId, 9009, contractAddress]);
    const after = BigInt(values.at(-2));
    return [published ? events.filter(e => BigInt(e.id) > after).slice(0, values.at(-1)) : []];
  },
};
const entityKeys = ["tenantId", "entityId", "entityType", "entityTypeLabel", "metadataHash", "currentState", "currentStateLabel", "currentCustodian", "closed", "createdAt", "closedAt"].sort();
const eventKeys = ["eventId", "eventName", "blockNumber", "transactionHash", "transactionIndex", "logIndex", "eventType", "eventTypeLabel", "stateAfter", "stateAfterLabel", "linkType", "linkTypeLabel", "metadataHash", "evidenceHash"].sort();
const path = `/public/v1/tenants/${tenantId}/entities/${entityId}`;
const app = Fastify({ logger: false });
app.setErrorHandler(perimeter.handler);
app.addHook("preHandler", authHook);
await app.register(swagger, { openapi: { info: { title: "Public verification", version: "1" } } });
await registerPublicDiscoveryRoutes(app, { db, chainId: 9009, contractAddress });
app.get("/v1/probe", async () => ({ private: true }));
await app.ready();
try {
  for (const prefix of ["/v1", "/v%31", "/%76%31"]) {
    const denied = await app.inject(prefix + "/probe");
    assert.equal(denied.statusCode, 401, "Encoded operator URL bypassed authentication");
    assert.equal(denied.json().error.code, "authentication_required");
  }
  const hidden = await app.inject(path);
  const missing = await app.inject(path.replace(entityId, unknownId));
  assert.equal(hidden.statusCode, 404);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(hidden.json(), missing.json());
  assert.equal((await app.inject(path + "/history")).statusCode, 404);
  assert.equal((await app.inject(path.replace(tenantId, unknownId))).statusCode, 404);
  const beforeInvalid = queryCount;
  for (const invalid of [path.replace(tenantId, "bad"), path.replace(entityId, "bad")]) assert.equal((await app.inject(invalid)).statusCode, 400);
  assert.equal(queryCount, beforeInvalid, "Malformed IDs must not query the DB");

  published = true;
  const detail = await app.inject(path);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(detail.json()).sort(), entityKeys);
  assert.equal(detail.json().closed, false);
  assert.ok(!detail.body.includes(sentinel));
  const upper = path.replace(tenantId, "0x" + tenantId.slice(2).toUpperCase()).replace(entityId, "0x" + entityId.slice(2).toUpperCase());
  assert.equal((await app.inject(upper)).statusCode, 200);

  const history = await app.inject(path + "/history");
  assert.equal(history.statusCode, 200);
  assert.equal(history.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(history.json()).sort(), ["tenantId", "entityId", "entity", "events", "page"].sort());
  assert.deepEqual(Object.keys(history.json().page).sort(), ["limit", "hasMore", "nextAfterEventId"].sort());
  assert.deepEqual(Object.keys(history.json().entity).sort(), entityKeys);
  for (const event of history.json().events) assert.deepEqual(Object.keys(event).sort(), eventKeys);
  assert.ok(!history.body.includes(sentinel));
  assert.ok(!history.body.includes(unknownId), "Private relationship endpoint leaked");
  assert.equal(history.json().page.limit, 50);
  const first = (await app.inject(path + "/history?limit=1")).json();
  assert.equal(first.page.hasMore, true);
  assert.equal(first.page.nextAfterEventId, events[0].id);
  const last = (await app.inject(path + "/history?limit=1&afterEventId=" + first.page.nextAfterEventId)).json();
  assert.equal(last.events[0].eventId, events[1].id);
  assert.equal(last.page.hasMore, false);
  assert.equal(last.page.nextAfterEventId, null);
  const empty = (await app.inject(path + "/history?afterEventId=" + events[1].id)).json();
  assert.deepEqual(empty.events, []);
  assert.equal(empty.page.nextAfterEventId, null);
  for (const value of ["0", "101", "-1", "1.5", "1e2", ""]) assert.equal((await app.inject(path + "/history?limit=" + value)).statusCode, 400);
  for (const value of ["-1", "abc", "1.5", "18446744073709551616", "9".repeat(30)]) assert.equal((await app.inject(path + "/history?afterEventId=" + value)).statusCode, 400);
  const openapi = app.swagger();
  for (const suffix of ["", "/history"]) {
    const route = openapi.paths["/public/v1/tenants/{tenantId}/entities/{entityId}" + suffix].get;
    assert.deepEqual(route.security, []);
    assert.ok(route.responses["200"]);
  }
  published = false;
  for (const suffix of ["", "/history"]) assert.equal((await app.inject(path + suffix)).statusCode, 404);
} finally {
  await app.close();
}

// Use the actual server options and custom error handler, so a swallowed 429,
// spoofed proxy IP, or widened allow-list fails this gate.
for (const prefixes of [["/public/v1", "/%70ublic/v1", "/public/v%31"], ["/v1", "/v%31", "/%76%31"]]) {
  const prefix = prefixes[0];
  const limited = Fastify({ logger: false });
  await limited.register(rateLimit, perimeter.options);
  limited.setErrorHandler(perimeter.handler);
  limited.get(prefix + "/probe", async () => ({ ok: true }));
  limited.get("/health", async () => ({ ok: true }));
  limited.get("/ready", async () => ({ ok: true }));
  try {
    for (let i = 0; i < 120; i += 1) assert.equal((await limited.inject(prefixes[i % prefixes.length] + "/probe")).statusCode, 200);
    for (const encoded of prefixes) {
      const blocked = await limited.inject({ url: encoded + "/probe", headers: { "x-forwarded-for": "198.51.100.9" } });
      assert.equal(blocked.statusCode, 429, "Encoded route bypassed the shared rate limit");
      assert.equal(blocked.json().error.code, "rate_limit_exceeded");
      assert.ok(blocked.headers["retry-after"]);
    }
    for (const url of ["/health", "/ready"]) assert.equal((await limited.inject(url)).statusCode, 200);
  } finally {
    await limited.close();
  }
}

// Direct invocation prevents npm's public:publish script from injecting a mode.
// Dummy configuration and an unreachable DB port keep these four cases offline.
const dummyEnv = {
  ...process.env, DOTENV_CONFIG_PATH: "/dev/null", TRACEFORGE_CHAIN_ID: "9009",
  TRACEFORGE_CONTRACT_ADDRESS: contractAddress, TRACEFORGE_BROADCAST_ENABLED: "false",
  MYSQL_HOST: "127.0.0.1", MYSQL_PORT: "1", MYSQL_DATABASE: "unused_public_test",
  MYSQL_USER: "unused_public_test", MYSQL_PASSWORD: "unused_test_value",
};
const ids = ["--tenant", tenantId, "--entity", entityId];
for (const [args, expected] of [
  [ids, "Exactly one of --publish or --unpublish is required"],
  [[...ids, "--publish", "--unpublish"], "Exactly one of --publish or --unpublish is required"],
  [["--publish", "--tenant", "bad", "--entity", entityId], "--tenant must be a bytes32 tenant ID"],
  [["--publish", "--tenant", tenantId, "--entity", "bad"], "--entity must be a bytes32 entity ID"],
]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/set-public-entity.ts", ...args], { env: dummyEnv, encoding: "utf8", timeout: 10000 });
  assert.equal(result.error, undefined, "Publication CLI did not finish");
  assert.notEqual(result.status, 0, "Invalid CLI invocation unexpectedly succeeded");
  assert.ok((result.stdout + result.stderr).includes(expected), "CLI failed without the expected validation error: " + expected);
}

console.log("PUBLIC DISCOVERY VERIFIED.");
console.log("Publication gates, response allow-lists, normalization, cursor bounds, and unauthenticated OpenAPI passed.");
console.log("Encoded operator URLs require auth; both route namespaces share their limits with encoded variants. Monitoring endpoints remain exempt.");
console.log("Four direct CLI negative cases passed without accessing a database or real credentials.");
