import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

interface TrackingRow extends RowDataPacket { tracking_id: string }
const bytes32 = /^0x[0-9a-fA-F]{64}$/;

export function newPublicTrackingId(): string {
  return "0x" + randomBytes(32).toString("hex");
}

// The registry reserves IDs independently of publication. Unpublishing does
// not delete/reassign an ID; public reads still require publication + entity.
export async function issuePublicTrackingId(
  db: Pick<Pool, "query">,
  tenant: string,
  entity: string,
  generate: () => string = newPublicTrackingId,
): Promise<string> {
  if (!bytes32.test(tenant) || !bytes32.test(entity)) throw new Error("Tenant and entity IDs must be bytes32 values.");
  const tenantId = tenant.toLowerCase();
  const entityId = entity.toLowerCase();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const [existing] = await db.query<TrackingRow[]>(
      `SELECT CONCAT('0x', LOWER(HEX(t.tracking_id))) AS tracking_id
       FROM public_entity_tracking_ids t
       JOIN public_entity_publications p ON p.tenant_id = t.tenant_id AND p.entity_id = t.entity_id
       JOIN entities e ON e.tenant_id = p.tenant_id AND e.entity_id = p.entity_id
       WHERE t.tenant_id = ? AND t.entity_id = ? LIMIT 1`,
      [tenantId, entityId],
    );
    if (existing[0]) return existing[0].tracking_id;
    const trackingId = generate();
    if (!/^0x[0-9a-f]{64}$/.test(trackingId)) throw new Error("Tracking ID generator returned an invalid ID.");
    try {
      const [result] = await db.query<ResultSetHeader>(
        `INSERT INTO public_entity_tracking_ids (tracking_id, tenant_id, entity_id)
         SELECT UNHEX(SUBSTRING(?, 3)), p.tenant_id, p.entity_id
         FROM public_entity_publications p
         JOIN entities e ON e.tenant_id = p.tenant_id AND e.entity_id = p.entity_id
         WHERE p.tenant_id = ? AND p.entity_id = ?`,
        [trackingId, tenantId, entityId],
      );
      if (result.affectedRows !== 1) throw new Error("Entity must exist and be explicitly published before issuing a tracking ID.");
      return trackingId;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY")) throw error;
      // A concurrent issuer may have reserved this pair, or the random ID
      // collided with another pair. Recheck the pair before generating again.
    }
  }
  throw new Error("Could not reserve a unique public tracking ID; retry later.");
}
