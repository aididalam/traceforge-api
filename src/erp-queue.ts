import { randomUUID } from "node:crypto";
import { BaseError, ContractFunctionRevertedError } from "viem";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { db } from "./db.js";
import { digest } from "./operator-credentials.js";
import { readTraceForge } from "./chain.js";
import { businessActions, productReference } from "./business.js";
import type { CreateInput, ReceiveInput, RemoveInput } from "./business.js";
import { BusinessProblem } from "./business-write.js";
import { canonicalRequestHash } from "./write-journal.js";
import { ErpProblem, erpKeyPrincipal, erpScope, jsonValue, safeErpResult } from "./erp.js";
import type { ErpPrincipal } from "./erp.js";
import type { ErpOperation, ErpScope } from "./erp-input.js";

interface StoredRequest extends ErpOperation {reference: string | null; occurredAt: string | null}
interface Prepared {action: ErpOperation["action"]; trackingId?: string; input: CreateInput | ReceiveInput | RemoveInput}
const active = "('QUEUED','PROCESSING','RETRY')";
const key = (operationId: string) => "erp_" + operationId;
const transient = new Set(["business_busy", "chain_unavailable", "receipt_unverified", "writes_disabled", "integration_unavailable", "operator_unavailable", "business_not_ready", "queue_lease_lost"]);

async function prepare(row: RowDataPacket): Promise<Prepared> {
  const request = jsonValue<StoredRequest>(row.request_json), idempotencyKey = key(row.operation_id);
  if (request.action === "create") return {action: "create", input: {...request.data, idempotencyKey} as unknown as CreateInput};
  const ref = await productReference(request.productCode!), batch = ref.initial_quantity != null && BigInt(ref.initial_quantity) > 1n;
  const data = {...request.data};
  const route = request.action === "receive" ? "sourceRouteId" : "routeId";
  if (batch && !data[route] || !batch && (data[route] !== undefined || data.quantity !== 1)) throw new ErpProblem("invalid_request");
  if (data.version === undefined) {
    try {
      data.version = String(batch ? (await readTraceForge("getBatchRoute", [ref.tenant_id, ref.entity_id, data[route]])).version :
        await readTraceForge("getCustodyVersion", [ref.tenant_id, ref.entity_id]));
    } catch (error) {
      if (error instanceof BaseError && error.walk(cause => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError)
        throw new ErpProblem("operation_not_allowed", 409);
      throw new ErpProblem("chain_unavailable", 503);
    }
  }
  data.integration = {operationId: row.operation_id, reference: request.reference, occurredAt: request.occurredAt};
  return {action: request.action, trackingId: ref.tracking_id, input: {...data, idempotencyKey} as unknown as ReceiveInput | RemoveInput};
}
async function execute(principal: ErpPrincipal, request: Prepared) {
  if (request.action === "create") return businessActions.create(principal.operator, request.input as CreateInput);
  if (request.action === "receive") return businessActions.receive(principal.operator, request.trackingId!, request.input as ReceiveInput);
  return businessActions.close(principal.operator, request.trackingId!, request.input as RemoveInput);
}

// One organization is processed in order. A durable lease and the existing wallet
// lock/journal make worker restarts and uncertain blockchain responses recoverable.
export async function processErpQueueOnce(options: {shouldStop?:()=>boolean} = {}): Promise<{processed: number; pending: number}> {
  const [candidates] = await db.query<RowDataPacket[]>(`SELECT o.* FROM erp_operations o
    WHERE o.chain_id=? AND o.contract_address=? AND o.status IN ${active}
      AND o.next_attempt_at<=CURRENT_TIMESTAMP(3) AND (o.lease_until IS NULL OR o.lease_until<=CURRENT_TIMESTAMP(3))
      AND NOT EXISTS (SELECT 1 FROM erp_operations earlier WHERE earlier.chain_id=o.chain_id
        AND earlier.contract_address=o.contract_address AND earlier.organization_id=o.organization_id
        AND earlier.sequence_id<o.sequence_id AND earlier.status IN ${active})
    ORDER BY o.sequence_id LIMIT 25`, [...erpScope]);
  let processed = 0;
  for (const candidate of candidates) {
    if(options.shouldStop?.())break;
    const conn = await db.getConnection(), lock = "tf-erp-work:" + digest(candidate.organization_id).slice(0, 40);
    const leaseToken = randomUUID();
    let locked = false, heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const [locks] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?,0) acquired", [lock]);
      locked = Number(locks[0].acquired) === 1;
      if (!locked) continue;
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM erp_operations WHERE operation_id=? AND status IN ${active}
        AND next_attempt_at<=CURRENT_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP(3))`, [candidate.operation_id]);
      if (!rows[0]) continue;
      const row = rows[0];
      await conn.query(`UPDATE erp_operations SET status='PROCESSING',attempts=attempts+1,lease_token=?,
        lease_until=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 90 SECOND) WHERE operation_id=?`, [leaseToken, row.operation_id]);
      // No sensitive request, credential or SQL exception is written to worker logs.
      heartbeat = setInterval(() => {
        void db.query("UPDATE erp_operations SET lease_until=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 90 SECOND) WHERE operation_id=? AND lease_token=?", [row.operation_id, leaseToken]).catch(() => {});
      }, 20000);
      const save = async (status: string, errorCode: string | null, result: unknown = null, retrySeconds = 0) => {
        await conn.query(`UPDATE erp_operations SET status=?,error_code=?,result_json=?,lease_token=NULL,lease_until=NULL,
          next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL ? SECOND) WHERE operation_id=? AND lease_token=?`,
          [status, errorCode, result ? JSON.stringify(safeErpResult(result)) : null, retrySeconds, row.operation_id, leaseToken]);
      };
      try {
        const hash = canonicalRequestHash({organizationId: row.organization_id, key: key(row.operation_id)}).slice(2);
        const [journal] = await conn.query<RowDataPacket[]>("SELECT status FROM chain_write_operations WHERE organization_id=? AND idempotency_key=?", [row.organization_id, hash]);
        let principal = await erpKeyPrincipal(row.key_id);
        const hasJournal = journal.length > 0;
        if (!principal || !principal.scopes.includes(("products:" + row.action) as ErpScope)) {
          // Prepared/submitted writes have already been authorized and cannot be
          // rolled back by revoking a key. Finish that exact write; cancel new work.
          if (!hasJournal) { await save("CANCELLED", "access_revoked"); processed++; continue; }
          principal = await erpKeyPrincipal(row.key_id, true);
          if (!principal) throw new ErpProblem("integration_unavailable", 503);
        }
        let prepared: Prepared;
        if (row.prepared_json) prepared = jsonValue<Prepared>(row.prepared_json);
        else {
          prepared = await prepare(row);
          const [saved] = await conn.query<ResultSetHeader>("UPDATE erp_operations SET prepared_json=? WHERE operation_id=? AND lease_token=? AND lease_until>CURRENT_TIMESTAMP(3)", [JSON.stringify(prepared), row.operation_id, leaseToken]);
          if (saved.affectedRows !== 1) throw new ErpProblem("queue_lease_lost", 503);
        }
        const [owned] = await conn.query<RowDataPacket[]>("SELECT operation_id FROM erp_operations WHERE operation_id=? AND lease_token=? AND lease_until>CURRENT_TIMESTAMP(3)", [row.operation_id, leaseToken]);
        if (!owned[0]) throw new ErpProblem("queue_lease_lost", 503);
        const result = await execute(principal, prepared);
        if (result.status === "CONFIRMED") await save("CONFIRMED", null, result);
        else await save("RETRY", "transaction_pending", result, 2);
      } catch (error) {
        const code = error instanceof ErpProblem || error instanceof BusinessProblem ? error.code : "integration_unavailable";
        const delay = Math.min(300, 2 ** Math.min(Number(row.attempts) + 1, 8));
        if (transient.has(code)) await save("RETRY", code, row.result_json ? jsonValue(row.result_json) : null, delay);
        else await save("FAILED", code);
      }
      processed++;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [lock]).catch(() => {});
      conn.release();
    }
  }
  const [counts] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) count FROM erp_operations WHERE chain_id=? AND contract_address=? AND status IN ${active}`, [...erpScope]);
  return {processed, pending: Number(counts[0].count)};
}
