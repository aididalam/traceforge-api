import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Fastify from "fastify";

// Explicit local test only. Temporary tables shadow live tables on ONE held
// connection. Disconnect drops them even after interruption; no applied schema,
// live publications/entities, credentials or blockchain writes are changed.
process.env.TRACEFORGE_BROADCAST_ENABLED = "false";
const { db } = await import("../dist/db.js");
const { issuePublicTrackingId } = await import("../dist/public-tracking.js");
const { registerPublicTrackingRoutes } = await import("../dist/routes/public-tracking.js");
const connection = await db.getConnection();
const query = async (sql, values = []) => (await connection.query(sql, values))[0];
const liveCounts = async () => {
  const [rows] = await db.query("SELECT (SELECT COUNT(*) FROM entities) AS entities, (SELECT COUNT(*) FROM public_entity_publications) AS publications, (SELECT COUNT(*) FROM chain_write_operations) AS operations");
  return rows[0];
};
const before = await liveCounts();
const tenant = "0x" + "ab".repeat(32), other = "0x" + "12".repeat(32), entity = "0x" + "cd".repeat(32);
const unknown = "0x" + "ef".repeat(32);
const app = Fastify({ logger: false });
try {
  await query("CREATE TEMPORARY TABLE entities (tenant_id VARCHAR(66) NOT NULL, entity_id VARCHAR(66) NOT NULL, PRIMARY KEY (tenant_id, entity_id))");
  for (const name of ["004_public_entity_publications.sql", "005_public_entity_tracking_ids.sql"]) {
    await query(readFileSync("migrations/" + name, "utf8").replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMPORARY TABLE"));
  }
  for (const t of [tenant, other]) {
    await query("INSERT INTO entities (tenant_id, entity_id) VALUES (?, ?)", [t, entity]);
    await query("INSERT INTO public_entity_publications (tenant_id, entity_id) VALUES (?, ?)", [t, entity]);
  }
  const bound = { query: connection.query.bind(connection) };
  const one = await issuePublicTrackingId(bound, tenant, entity);
  let attempt = 0;
  const two = await issuePublicTrackingId(bound, other, entity, () => ++attempt === 1 ? one : unknown);
  assert.notEqual(one, two);
  assert.equal(attempt, 2, "Real global PK collision must retry");
  assert.equal(await issuePublicTrackingId(bound, tenant, entity), one);
  await assert.rejects(query("INSERT INTO public_entity_tracking_ids (tracking_id, tenant_id, entity_id) VALUES (UNHEX(SUBSTRING(?, 3)), ?, ?)", ["0x" + "78".repeat(32), tenant, entity]), { code: "ER_DUP_ENTRY" });
  await registerPublicTrackingRoutes(app, { db: bound });
  for (const [id, t] of [[one, tenant], [two, other]]) {
    const result = await app.inject("/public/v1/tracking/" + id);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), { trackingId: id, tenantId: t, entityId: entity });
  }
  await query("DELETE FROM public_entity_publications WHERE tenant_id = ?", [tenant]);
  const hidden = await app.inject("/public/v1/tracking/" + one);
  const missing = await app.inject("/public/v1/tracking/" + "0x" + "90".repeat(32));
  assert.equal(hidden.statusCode, 404);
  assert.deepEqual(hidden.json(), missing.json());
  await assert.rejects(issuePublicTrackingId(bound, tenant, entity), /explicitly published/);
  await query("INSERT INTO public_entity_publications (tenant_id, entity_id) VALUES (?, ?)", [tenant, entity]);
  assert.equal(await issuePublicTrackingId(bound, tenant, entity), one);
  assert.equal((await query("SELECT COUNT(*) AS count FROM public_entity_tracking_ids"))[0].count, 2);
  await query("DELETE FROM entities WHERE tenant_id = ?", [tenant]);
  assert.equal((await app.inject("/public/v1/tracking/" + one)).statusCode, 404);
  assert.deepEqual(await liveCounts(), before, "Live counts changed during temporary test");
  console.log("Public tracking MySQL test passed: real PK/pair uniqueness, collision retry, tenant isolation, publication/republication and dangling-map privacy. Live counts unchanged.");
} finally {
  await app.close();
  connection.destroy();
  await db.end();
}
