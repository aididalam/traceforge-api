import { db } from "./db.js";
import { issuePublicTrackingId } from "./public-tracking.js";

const args = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1];
let exitCode = 0;
try {
  if (args.length !== 4 || args.filter(arg => arg === "--tenant").length !== 1 ||
      args.filter(arg => arg === "--entity").length !== 1) {
    throw new Error("Use --tenant <bytes32> --entity <bytes32> exactly once each.");
  }
  const tenant = value("--tenant");
  const entity = value("--entity");
  if (!/^0x[0-9a-fA-F]{64}$/.test(tenant ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(entity ?? "")) {
    throw new Error("Tenant and entity IDs must be bytes32 values.");
  }
  const id = await issuePublicTrackingId(db, tenant, entity);
  console.log("PUBLIC TRACKING ID READY.");
  console.log(`Tracking ID: ${id}`);
  console.log(`Public path: /track/${id}`);
} catch (error) {
  // Never print SQL/connection details or configuration from a DB error.
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const safeMessages = new Set([
    "Use --tenant <bytes32> --entity <bytes32> exactly once each.",
    "Tenant and entity IDs must be bytes32 values.",
    "Tracking ID generator returned an invalid ID.",
    "Entity must exist and be explicitly published before issuing a tracking ID.",
    "Could not reserve a unique public tracking ID; retry later.",
  ]);
  console.error(code === "ER_NO_SUCH_TABLE" ? "Apply migration 005_public_entity_tracking_ids.sql before issuing tracking IDs." :
    error instanceof Error && safeMessages.has(error.message) ? error.message : "Public tracking ID issuance failed.");
  exitCode = 1;
} finally {
  try { await db.end(); }
  catch { console.error("Database cleanup failed."); exitCode = 1; }
}
process.exitCode = exitCode;
