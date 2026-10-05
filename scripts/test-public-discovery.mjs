import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// Local integration only. Use the application's DB configuration internally;
// never read operator tokens/keys or expose credentials. All DB writes below
// (including the CLI) are limited to initially unpublished fixture entities.
process.env.TRACEFORGE_BROADCAST_ENABLED = "false";
const { db } = await import("../dist/db.js");
const { config } = await import("../dist/config.js");
assert.equal(config.traceforge.broadcastEnabled, false);
const childEnv = {
  ...process.env,
  TRACEFORGE_BROADCAST_ENABLED: "false",
  TRACEFORGE_SIGNER_ADDRESS: "",
  TRACEFORGE_SIGNER_KEY_FILE: "",
  TRACEFORGE_SIGNER_MAP_FILE: "",
};
const query = async (sql, args = []) => (await db.query(sql, args))[0];
const scope = [config.traceforge.chainId, config.traceforge.contractAddress];
const ownPublications = [];
const servers = [];
const sentinel = "public-discovery-redaction-check-not-an-operator-token";
const entityKeys = ["tenantId", "entityId", "entityType", "entityTypeLabel", "metadataHash", "currentState", "currentStateLabel", "currentCustodian", "closed", "createdAt", "closedAt"].sort();
const eventKeys = ["eventId", "eventName", "blockNumber", "transactionHash", "transactionIndex", "logIndex", "eventType", "eventTypeLabel", "stateAfter", "stateAfterLabel", "linkType", "linkTypeLabel", "metadataHash", "evidenceHash"].sort();

async function publicationSnapshot() {
  return query("SELECT tenant_id, entity_id, published_at FROM public_entity_publications ORDER BY tenant_id, entity_id");
}

async function readonlyCounts() {
  const counts = {};
  for (const name of ["entities", "chain_events", "trace_events", "chain_write_operations", "api_auth_tokens"]) counts[name] = (await query("SELECT COUNT(*) AS count FROM " + name))[0].count;
  return counts;
}

async function cli(args, expected, success) {
  const child = spawn(process.execPath, ["dist/set-public-entity.js", ...args], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    const [code, signal] = await once(child, "close");
    assert.equal(signal, null, "Publication CLI timed out or was interrupted");
    if (success) assert.equal(code, 0, "Publication CLI unexpectedly failed");
    else assert.notEqual(code, 0, "Invalid publication CLI invocation succeeded");
    assert.ok(output.includes(expected), "Missing expected CLI result: " + expected);
  } finally {
    clearTimeout(timeout);
  }
}

async function startApi() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: { ...childEnv, API_HOST: "127.0.0.1", API_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const server = { child, url: "http://127.0.0.1:" + port, logs: "", stopped: false };
  servers.push(server);
  child.stdout.on("data", chunk => { server.logs += chunk; });
  child.stderr.on("data", chunk => { server.logs += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    assert.equal(child.exitCode, null, "Test API exited during startup");
    try {
      const response = await fetch(server.url + "/ready", { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return server;
    } catch { /* Startup is not ready yet. */ }
    await delay(100);
  }
  throw new Error("Test API did not become ready");
}

async function stopApi(server) {
  if (server.stopped) return;
  if (server.child.exitCode !== null || server.child.signalCode !== null) {
    server.stopped = true;
    assert.equal(server.child.signalCode, null, "API exited unexpectedly");
    assert.equal(server.child.exitCode, 0, "API exited unexpectedly");
    return;
  }
  const exited = once(server.child, "close");
  server.child.kill("SIGTERM");
  const timeout = setTimeout(() => server.child.kill("SIGKILL"), 10000);
  try {
    const [code, signal] = await exited;
    assert.equal(signal, null, "API failed to stop gracefully");
    assert.equal(code, 0, "API shutdown failed");
    server.stopped = true;
    assert.ok(!server.logs.includes(sentinel), "Authorization header appeared in logs");
    assert.doesNotMatch(server.logs, /PRIVATE KEY|serialized_transaction|MYSQL_PASSWORD/);
  } finally {
    clearTimeout(timeout);
  }
}

async function get(server, path, headers = {}) {
  const response = await fetch(server.url + path, { headers, signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
}

function assertSafeHistory(result) {
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(result.body).sort(), ["tenantId", "entityId", "entity", "events", "page"].sort());
  assert.deepEqual(Object.keys(result.body.page).sort(), ["limit", "hasMore", "nextAfterEventId"].sort());
  assert.deepEqual(Object.keys(result.body.entity).sort(), entityKeys);
  for (const event of result.body.events) assert.deepEqual(Object.keys(event).sort(), eventKeys);
}

async function allHistory(server, path, limit) {
  const events = [];
  let after = "0";
  for (let page = 0; page < 1000; page += 1) {
    const result = await get(server, path + `/history?limit=${limit}&afterEventId=${after}`);
    assertSafeHistory(result);
    assert.ok(result.body.events.length <= limit);
    for (const event of result.body.events) assert.ok(BigInt(event.eventId) > BigInt(after));
    events.push(...result.body.events);
    if (!result.body.page.hasMore) {
      assert.equal(result.body.page.nextAfterEventId, null);
      return events;
    }
    assert.ok(result.body.events.length > 0);
    assert.equal(result.body.page.nextAfterEventId, result.body.events.at(-1).eventId);
    assert.ok(BigInt(result.body.page.nextAfterEventId) > BigInt(after));
    after = result.body.page.nextAfterEventId;
  }
  throw new Error("Public history cursor did not terminate");
}

let baseline;
let countsBefore;
let relationshipCheck = "No unpublished outgoing linked fixture; relationship runtime check skipped.";
try {
  baseline = await publicationSnapshot();
  countsBefore = await readonlyCounts();
  const migrations = await query("SELECT migration_name FROM api_schema_migrations WHERE migration_name = ?", ["004_public_entity_publications.sql"]);
  assert.equal(migrations.length, 1, "Apply migration 004 before running this local integration test");
  const fixtures = await query(`SELECT e.tenant_id, e.entity_id FROM entities e
    WHERE NOT EXISTS (SELECT 1 FROM public_entity_publications p WHERE p.tenant_id = e.tenant_id AND p.entity_id = e.entity_id)
    ORDER BY e.created_event_id LIMIT 1`);
  assert.equal(fixtures.length, 1, "An unpublished indexed entity is required; existing publications will not be removed");
  const fixture = fixtures[0];
  const tenantId = fixture.tenant_id;
  const entityId = fixture.entity_id;
  ownPublications.push(fixture);
  const path = `/public/v1/tenants/${tenantId}/entities/${entityId}`;
  const unknownId = "0x" + "fe".repeat(32);
  assert.equal((await query("SELECT entity_id FROM entities WHERE tenant_id = ? AND entity_id = ?", [tenantId, unknownId])).length, 0);
  const ids = ["--tenant", tenantId, "--entity", entityId];
  for (const [args, expected] of [
    [ids, "Exactly one of --publish or --unpublish is required"],
    [[...ids, "--publish", "--unpublish"], "Exactly one of --publish or --unpublish is required"],
    [["--publish", "--tenant", "bad", "--entity", entityId], "--tenant must be a bytes32 tenant ID"],
    [["--publish", "--tenant", tenantId, "--entity", "bad"], "--entity must be a bytes32 entity ID"],
    [["--publish", "--tenant", tenantId, "--entity", unknownId], "Entity does not exist in the indexed read model."],
  ]) {
    await cli(args, expected, false);
    assert.deepEqual(await publicationSnapshot(), baseline, "Failed CLI invocation changed publication rows");
  }

  const server = await startApi();
  const hidden = await get(server, path);
  const missing = await get(server, path.replace(entityId, unknownId));
  assert.equal(hidden.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(hidden.body, missing.body);
  const hiddenHistory = await get(server, path + "/history");
  const missingHistory = await get(server, path.replace(entityId, unknownId) + "/history");
  assert.equal(hiddenHistory.status, 404);
  assert.equal(missingHistory.status, 404);
  assert.deepEqual(hiddenHistory.body, missingHistory.body);
  for (const invalid of [path.replace(tenantId, "bad"), path.replace(entityId, "bad")]) assert.equal((await get(server, invalid)).status, 400);
  for (const prefix of ["/v1", "/v%31", "/%76%31"]) {
    const denied = await get(server, `${prefix}/tenants/${tenantId}/entities/${entityId}`);
    assert.equal(denied.status, 401, "Encoded operator URL bypassed authentication");
    assert.equal(denied.body.error.code, "authentication_required");
  }
  assert.equal((await get(server, `/v1/tenants/${tenantId}/entities/${entityId}`, { Authorization: "Bearer " + sentinel })).status, 401);

  const upperIds = ["--tenant", "0x" + tenantId.slice(2).toUpperCase(), "--entity", "0x" + entityId.slice(2).toUpperCase()];
  await cli([...upperIds, "--publish"], "PUBLIC ENTITY PUBLISHED.", true);
  await cli([...ids, "--publish"], "PUBLIC ENTITY PUBLISHED.", true);
  assert.equal((await query("SELECT COUNT(*) AS count FROM public_entity_publications WHERE tenant_id = ? AND entity_id = ?", [tenantId, entityId]))[0].count, 1);
  const detail = await get(server, path);
  assert.equal(detail.status, 200);
  assert.deepEqual(Object.keys(detail.body).sort(), entityKeys);
  assert.equal(detail.headers.get("cache-control"), "no-store");
  for (const prefix of ["/%70ublic/v1", "/public/v%31"]) assert.deepEqual((await get(server, path.replace("/public/v1", prefix))).body, detail.body);
  const upperPath = path.replace(tenantId, "0x" + tenantId.slice(2).toUpperCase()).replace(entityId, "0x" + entityId.slice(2).toUpperCase());
  assert.deepEqual((await get(server, upperPath)).body, detail.body);
  const all = await allHistory(server, path, 100);
  const paginated = await allHistory(server, path, 3);
  assert.deepEqual(paginated, all);
  assert.equal(new Set(all.map(e => e.eventId)).size, all.length);
  for (const suffix of ["?limit=0", "?limit=101", "?afterEventId=-1", "?afterEventId=18446744073709551616"]) assert.equal((await get(server, path + "/history" + suffix)).status, 400);

  // An orphan publication under another tenant must not grant access to the
  // fixture's entity or events. This tests the real SQL tenant joins.
  const orphan = { tenant_id: unknownId, entity_id: entityId };
  assert.equal((await query("SELECT entity_id FROM entities WHERE tenant_id = ? AND entity_id = ?", [orphan.tenant_id, orphan.entity_id])).length, 0);
  assert.equal((await query("SELECT entity_id FROM public_entity_publications WHERE tenant_id = ? AND entity_id = ?", [orphan.tenant_id, orphan.entity_id])).length, 0);
  ownPublications.push(orphan);
  await query("INSERT INTO public_entity_publications (tenant_id, entity_id) VALUES (?, ?)", [orphan.tenant_id, orphan.entity_id]);
  for (const suffix of ["", "/history"]) {
    const denied = await get(server, path.replace(tenantId, orphan.tenant_id) + suffix);
    assert.equal(denied.status, 404, "Publication exposed another tenant's entity");
    assert.deepEqual(denied.body, hidden.body);
  }
  await query("DELETE FROM public_entity_publications WHERE tenant_id = ? AND entity_id = ?", [orphan.tenant_id, orphan.entity_id]);

  // Independently derive expected visibility from event identifiers and the
  // publication snapshot, instead of reproducing the route's SQL expression.
  const raw = await query(`SELECT CAST(id AS CHAR) AS id, event_name,
      JSON_UNQUOTE(JSON_EXTRACT(event_args, '$.entityId')) AS entity_id,
      JSON_UNQUOTE(JSON_EXTRACT(event_args, '$.sourceEntityId')) AS source_id,
      JSON_UNQUOTE(JSON_EXTRACT(event_args, '$.targetEntityId')) AS target_id
    FROM chain_events WHERE chain_id = ? AND contract_address = ?
      AND JSON_UNQUOTE(JSON_EXTRACT(event_args, '$.tenantId')) = ? ORDER BY id`, [...scope, tenantId]);
  const expectedIds = async () => {
    const publications = await publicationSnapshot();
    const published = new Set(publications.filter(p => p.tenant_id === tenantId).map(p => p.entity_id));
    return raw.filter(e => e.entity_id === entityId || ((e.source_id === entityId || e.target_id === entityId) && published.has(e.source_id) && published.has(e.target_id))).map(e => String(e.id));
  };
  assert.deepEqual(all.map(e => e.eventId), await expectedIds());
  const counterparts = await query(`SELECT e.tenant_id, e.entity_id FROM entity_links l JOIN entities e
    ON e.tenant_id = l.tenant_id AND e.entity_id = l.target_entity_id
    WHERE l.tenant_id = ? AND l.source_entity_id = ?
      AND NOT EXISTS (SELECT 1 FROM public_entity_publications p WHERE p.tenant_id = e.tenant_id AND p.entity_id = e.entity_id)
    ORDER BY l.created_event_id LIMIT 1`, [tenantId, entityId]);
  if (counterparts.length) {
    const counterpart = counterparts[0];
    ownPublications.push(counterpart);
    assert.ok(!JSON.stringify(all).includes(counterpart.entity_id));
    const partnerArgs = ["--tenant", counterpart.tenant_id, "--entity", counterpart.entity_id];
    await cli([...partnerArgs, "--publish"], "PUBLIC ENTITY PUBLISHED.", true);
    const linked = await allHistory(server, path, 100);
    assert.deepEqual(linked.map(e => e.eventId), await expectedIds());
    assert.ok(linked.length > all.length, "Publishing the counterparty should reveal matching relationship events");
    assert.ok(!JSON.stringify(linked).includes(counterpart.entity_id), "Relationship endpoint IDs leaked");
    await cli([...partnerArgs, "--unpublish"], "PUBLIC ENTITY UNPUBLISHED.", true);
    assert.deepEqual(await allHistory(server, path, 100), all);
    relationshipCheck = "Relationship publication visibility and endpoint privacy passed.";
  }
  const openapi = (await get(server, "/openapi.json")).body;
  for (const suffix of ["", "/history"]) assert.deepEqual(openapi.paths["/public/v1/tenants/{tenantId}/entities/{entityId}" + suffix].get.security, []);
  await cli([...ids, "--unpublish"], "PUBLIC ENTITY UNPUBLISHED.", true);
  await cli([...ids, "--unpublish"], "PUBLIC ENTITY UNPUBLISHED.", true);
  for (const suffix of ["", "/history"]) assert.equal((await get(server, path + suffix)).status, 404);
  assert.equal((await get(server, "/health")).status, 200);
  assert.equal((await get(server, "/ready")).status, 200);
  await stopApi(server);

  const limiter = await startApi();
  const variants = [path, path.replace("/public/v1", "/%70ublic/v1"), path.replace("/public/v1", "/public/v%31")];
  for (let i = 0; i < 120; i += 1) assert.equal((await get(limiter, variants[i % variants.length])).status, 404);
  for (const variant of variants) {
    const blocked = await get(limiter, variant, { "x-forwarded-for": "198.51.100.8" });
    assert.equal(blocked.status, 429, "Encoded public route bypassed the shared rate limit");
    assert.equal(blocked.body.error.code, "rate_limit_exceeded");
    assert.ok(blocked.headers.get("retry-after"));
  }
  for (const prefix of ["/v1", "/v%31", "/%76%31"]) assert.equal((await get(limiter, `${prefix}/tenants/${tenantId}/entities/${entityId}`)).status, 429);
  for (const monitoring of ["/health", "/ready"]) assert.equal((await get(limiter, monitoring)).status, 200);
  await stopApi(limiter);
  assert.deepEqual(await publicationSnapshot(), baseline);
  assert.deepEqual(await readonlyCounts(), countsBefore);
  console.log("PUBLIC DISCOVERY INTEGRATION PASSED.");
  console.log("CLI negatives/idempotency, publication lifecycle, cross-tenant isolation, response privacy, cursors, encoded-URL auth/rate limits, OpenAPI and graceful shutdown passed.");
  console.log(relationshipCheck);
  console.log("Only temporary publication rows were changed; all were cleaned up. No operator key/token files were read and no broadcast endpoint was called.");
} finally {
  let cleanupError;
  for (const server of servers) {
    try {
      if (!server.stopped) await stopApi(server);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  for (const fixture of ownPublications) {
    try {
      await query("DELETE FROM public_entity_publications WHERE tenant_id = ? AND entity_id = ?", [fixture.tenant_id, fixture.entity_id]);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  try {
    if (baseline !== undefined) assert.deepEqual(await publicationSnapshot(), baseline, "Publication cleanup failed");
  } finally {
    await db.end();
  }
  if (cleanupError) throw cleanupError;
}
