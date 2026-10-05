import { db } from "./db.js";
import { syncPublicDetails } from "./business.js";
import type { RowDataPacket } from "mysql2/promise";
try {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT r.* FROM business_product_records r
    JOIN entities e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id WHERE r.public_details=TRUE`);
  for (const row of rows) await syncPublicDetails(row);
  console.log(`Synced ${rows.length} opted-in product presentations.`);
} finally { await db.end(); }
