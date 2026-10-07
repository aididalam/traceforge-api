import { randomBytes, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "./db.js";
import { config } from "./config.js";
import { digest } from "./operator-credentials.js";
import { canonicalRequestHash } from "./write-journal.js";
import type { OperatorPrincipal } from "./operator-data.js";
import { erpText, parseErpScopes, pendingErpLimit, ErpProblem } from "./erp-input.js";
import type { ErpBatch, ErpScope } from "./erp-input.js";

export { ErpProblem };
export interface ErpPrincipal {
  keyId: string;
  scopes: ErpScope[];
  operator: OperatorPrincipal;
}
export const erpScope = [config.traceforge.chainId, config.traceforge.contractAddress.toLowerCase()] as const;
export const jsonValue = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) : value;
const epochIso = (value: unknown) => value == null ? null : new Date(Number(value) * 1000).toISOString();
const keyColumns = `key_id,key_name,key_prefix,scopes,UNIX_TIMESTAMP(expires_at) AS expires_epoch,
  UNIX_TIMESTAMP(revoked_at) AS revoked_epoch,UNIX_TIMESTAMP(created_at) AS created_epoch`;
const keyView = (row: RowDataPacket) => ({id: row.key_id, name: row.key_name, prefix: row.key_prefix,
  scopes: parseErpScopes(jsonValue(row.scopes)), expiresAt: epochIso(row.expires_epoch), revokedAt: epochIso(row.revoked_epoch), createdAt: epochIso(row.created_epoch)});

// Keys are hashed at rest and can authenticate only the integration API.
const keyAccountSql = `SELECT k.key_id,k.scopes,k.revoked_at,k.expires_at,
  (k.revoked_at IS NULL AND k.expires_at>CURRENT_TIMESTAMP AND a.active=TRUE AND o.active=TRUE) AS eligible,
  a.account_id,a.tenant_id,a.organization_id,a.email,a.display_name,b.business_name
  FROM erp_integration_keys k JOIN operator_accounts a ON a.account_id=k.account_id AND a.organization_id=k.organization_id
  JOIN organizations o ON o.organization_id=k.organization_id JOIN business_wallets b ON b.organization_id=k.organization_id`;
export async function erpKeyPrincipal(keyId: string, allowRevoked = false): Promise<ErpPrincipal | null> {
  const [rows] = await db.query<RowDataPacket[]>(keyAccountSql + " WHERE k.key_id=? LIMIT 1", [keyId]);
  const row = rows[0];
  if (!row || !allowRevoked && Number(row.eligible) !== 1) return null;
  return {keyId: row.key_id, scopes: parseErpScopes(jsonValue(row.scopes)), operator: {accountId: row.account_id,
    tenantId: row.tenant_id, organizationId: row.organization_id, email: row.email, name: row.display_name,
    workspaceName: row.business_name, organizationName: row.business_name, access: "manage"}};
}
export async function authenticateErp(header?: string): Promise<ErpPrincipal | null> {
  const token = /^Bearer (tferp_[A-Za-z0-9_-]{43})$/.exec(header ?? "")?.[1];
  if (!token) return null;
  const [rows] = await db.query<RowDataPacket[]>("SELECT key_id FROM erp_integration_keys WHERE key_hash=?", [digest(token)]);
  return rows[0] ? erpKeyPrincipal(rows[0].key_id) : null;
}
export async function createErpKey(principal: OperatorPrincipal, input: {name: unknown; scopes: unknown; expiresInDays?: unknown}) {
  let name: string, scopes: ErpScope[];
  try { name = erpText(input.name, 120); scopes = parseErpScopes(input.scopes); }
  catch { throw new ErpProblem("invalid_request"); }
  const days = input.expiresInDays ?? 365;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365)
    throw new ErpProblem("invalid_request");
  const conn = await db.getConnection(), lock = "tf-erp-key:" + digest(principal.organizationId).slice(0, 40);
  let locked = false;
  try {
    const [locks] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?,5) acquired", [lock]);
    locked = Number(locks[0].acquired) === 1;
    if (!locked) throw new ErpProblem("business_busy", 429);
    const [counts] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) count FROM erp_integration_keys WHERE organization_id=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP", [principal.organizationId]);
    if (Number(counts[0].count) >= 20) throw new ErpProblem("key_limit", 409);
    const secret = "tferp_" + randomBytes(32).toString("base64url"), keyId = randomUUID();
    await conn.query(`INSERT INTO erp_integration_keys (key_id,organization_id,account_id,key_hash,key_prefix,key_name,scopes,expires_at)
      VALUES (?,?,?,?,?,?,?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY))`,
      [keyId, principal.organizationId, principal.accountId, digest(secret), secret.slice(0, 14), name, JSON.stringify(scopes), days]);
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${keyColumns} FROM erp_integration_keys WHERE key_id=?`, [keyId]);
    return {key: keyView(rows[0]), secret};
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [lock]).catch(() => {});
    conn.release();
  }
}
export async function listErpKeys(principal: OperatorPrincipal) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${keyColumns} FROM erp_integration_keys WHERE organization_id=? ORDER BY created_at DESC,key_id DESC LIMIT 101`, [principal.organizationId]);
  return {keys: rows.slice(0, 100).map(keyView), truncated: rows.length > 100};
}
export async function revokeErpKey(principal: OperatorPrincipal, keyId: string) {
  const [rows] = await db.query<RowDataPacket[]>("SELECT key_id FROM erp_integration_keys WHERE key_id=? AND organization_id=?", [keyId, principal.organizationId]);
  if (!rows[0]) throw new ErpProblem("key_not_found", 404);
  await db.query("UPDATE erp_integration_keys SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE key_id=? AND organization_id=?", [keyId, principal.organizationId]);
  return {revoked: true};
}
export function safeErpResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>, result: Record<string, unknown> = {};
  for (const field of ["operationId", "status", "transactionHash", "blockNumber", "trackingId", "shortCode", "receivedRouteId", "quantity", "removedQuantity", "reason", "reasonText"])
    if (typeof source[field] === "string" || source[field] === null) result[field] = source[field];
  return result;
}
export async function getErpJob(principal: ErpPrincipal, jobId: string) {
  const [jobs] = await db.query<RowDataPacket[]>(`SELECT job_id,reference,
    CONCAT(DATE_FORMAT(occurred_at,'%Y-%m-%dT%H:%i:%s.'),LEFT(DATE_FORMAT(occurred_at,'%f'),3),'Z') AS occurred_at,
    UNIX_TIMESTAMP(created_at) AS created_epoch FROM erp_jobs WHERE job_id=? AND organization_id=? AND chain_id=? AND contract_address=?`, [jobId, principal.operator.organizationId, ...erpScope]);
  if (!jobs[0]) throw new ErpProblem("job_not_found", 404);
  const [rows] = await db.query<RowDataPacket[]>(`SELECT i.position,o.operation_id,o.action,o.status,o.attempts,o.error_code,o.result_json
    FROM erp_job_items i JOIN erp_operations o ON o.operation_id=i.operation_id WHERE i.job_id=? ORDER BY i.position`, [jobId]);
  const counts = {total: rows.length, confirmed: 0, failed: 0, cancelled: 0, pending: 0};
  for (const row of rows) {
    if (row.status === "CONFIRMED") counts.confirmed++;
    else if (row.status === "FAILED") counts.failed++;
    else if (row.status === "CANCELLED") counts.cancelled++;
    else counts.pending++;
  }
  const status = counts.pending ? rows.every(row => row.status === "QUEUED") ? "QUEUED" : "PROCESSING" :
    counts.confirmed === counts.total ? "COMPLETED" : counts.confirmed ? "PARTIAL_FAILURE" :
      counts.cancelled === counts.total ? "CANCELLED" : "FAILED";
  return {jobId, status, reference: jobs[0].reference, occurredAt: jobs[0].occurred_at, createdAt: epochIso(jobs[0].created_epoch), counts,
    items: rows.map(row => ({position: Number(row.position), operationId: row.operation_id, action: row.action, status: row.status,
      attempts: Number(row.attempts), error: row.error_code ? {code: row.error_code} : null,
      result: safeErpResult(row.result_json ? jsonValue(row.result_json) : null)}))};
}
export async function enqueueErpJob(principal: ErpPrincipal, batch: ErpBatch) {
  for (const operation of batch.operations)
    if (!principal.scopes.includes(("products:" + operation.action) as ErpScope)) throw new ErpProblem("insufficient_scope", 403);
  const org = principal.operator.organizationId, requestHash = canonicalRequestHash(batch as unknown as Record<string, unknown>);
  const conn = await db.getConnection(), lock = "tf-erp-enq:" + digest(org).slice(0, 40);
  let locked = false, jobId: string;
  try {
    const [locks] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?,5) acquired", [lock]);
    locked = Number(locks[0].acquired) === 1;
    if (!locked) throw new ErpProblem("business_busy", 429);
    await conn.beginTransaction();
    const [existing] = await conn.query<RowDataPacket[]>("SELECT job_id,request_hash FROM erp_jobs WHERE chain_id=? AND contract_address=? AND organization_id=? AND job_key_hash=?", [...erpScope, org, digest(batch.idempotencyKey)]);
    if (existing[0]) {
      if (existing[0].request_hash !== requestHash) throw new ErpProblem("request_conflict", 409);
      jobId = existing[0].job_id;
    } else {
      const [pending] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) count FROM erp_operations WHERE chain_id=? AND contract_address=? AND organization_id=? AND status IN ('QUEUED','PROCESSING','RETRY')", [...erpScope, org]);
      let newItems = 0;
      for (const item of batch.operations) {
        const [found] = await conn.query<RowDataPacket[]>("SELECT operation_id FROM erp_operations WHERE chain_id=? AND contract_address=? AND organization_id=? AND item_key_hash=?", [...erpScope, org, digest(item.idempotencyKey)]);
        if (!found[0]) newItems++;
      }
      if (Number(pending[0].count) + newItems > pendingErpLimit) throw new ErpProblem("queue_full", 429);
      jobId = randomUUID();
      await conn.query(`INSERT INTO erp_jobs (job_id,chain_id,contract_address,organization_id,key_id,job_key_hash,request_hash,reference,occurred_at)
        VALUES (?,?,?,?,?,?,?,?,?)`, [jobId, ...erpScope, org, principal.keyId, digest(batch.idempotencyKey), requestHash, batch.reference,
        batch.occurredAt ? batch.occurredAt.slice(0, -1).replace("T", " ") : null]);
      for (const [position, item] of batch.operations.entries()) {
        const request = {...item, reference: batch.reference, occurredAt: batch.occurredAt};
        const itemHash = canonicalRequestHash(request), keyHash = digest(item.idempotencyKey);
        const [found] = await conn.query<RowDataPacket[]>("SELECT operation_id,request_hash FROM erp_operations WHERE chain_id=? AND contract_address=? AND organization_id=? AND item_key_hash=?", [...erpScope, org, keyHash]);
        let operationId: string;
        if (found[0]) {
          if (found[0].request_hash !== itemHash) throw new ErpProblem("request_conflict", 409);
          operationId = found[0].operation_id;
        } else {
          operationId = randomUUID();
          await conn.query(`INSERT INTO erp_operations (operation_id,chain_id,contract_address,organization_id,key_id,item_key_hash,request_hash,action,request_json)
            VALUES (?,?,?,?,?,?,?,?,?)`, [operationId, ...erpScope, org, principal.keyId, keyHash, itemHash, item.action, JSON.stringify(request)]);
        }
        await conn.query("INSERT INTO erp_job_items(job_id,position,operation_id) VALUES(?,?,?)", [jobId, position + 1, operationId]);
      }
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [lock]).catch(() => {});
    conn.release();
  }
  return getErpJob(principal, jobId!);
}
