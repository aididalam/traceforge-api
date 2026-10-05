import "dotenv/config";

import assert from "node:assert/strict";
import mysql from "mysql2/promise";

function required(name) {
  const value =
    process.env[name];

  if (!value) {
    throw new Error(
      "Missing environment variable: " +
      name
    );
  }

  return value;
}

const db =
  await mysql.createConnection({
    host:
      required("MYSQL_HOST"),

    port:
      Number(
        required("MYSQL_PORT")
      ),

    database:
      required("MYSQL_DATABASE"),

    user:
      required("MYSQL_USER"),

    password:
      required("MYSQL_PASSWORD"),
  });

try {
  const [summary] =
    await db.query(
      "SELECT status, COUNT(*) AS total, SUM(serialized_transaction IS NOT NULL) AS serialized_present, SUM(transaction_hash IS NOT NULL) AS transaction_hash_present FROM chain_write_operations GROUP BY status ORDER BY status"
    );

  console.log(
    "=== JOURNAL STATUS SUMMARY ==="
  );

  console.table(summary);

  const audits = [
    [
      "invalid_status_rows",
      "SELECT operation_id, operation_name, idempotency_key, status FROM chain_write_operations WHERE status NOT IN ('PREPARED', 'BROADCAST', 'CONFIRMED', 'FAILED') ORDER BY operation_id"
    ],
    [
      "broken_confirmed_rows",
      "SELECT operation_id, operation_name, idempotency_key, status, transaction_hash, block_number, gas_used, (serialized_transaction IS NOT NULL) AS serialized_present FROM chain_write_operations WHERE status = 'CONFIRMED' AND (transaction_hash IS NULL OR block_number IS NULL OR gas_used IS NULL OR serialized_transaction IS NOT NULL) ORDER BY operation_id"
    ],
    [
      "recoverable_missing_serialized",
      "SELECT operation_id, operation_name, idempotency_key, status, transaction_hash FROM chain_write_operations WHERE status IN ('PREPARED', 'BROADCAST') AND serialized_transaction IS NULL ORDER BY operation_id"
    ],
    [
      "pending_recovery_rows",
      "SELECT operation_id, operation_name, idempotency_key, status, transaction_hash, error_code FROM chain_write_operations WHERE status IN ('PREPARED', 'BROADCAST') ORDER BY operation_id"
    ],
    [
      "duplicate_idempotency_rows",
      "SELECT tenant_id, operation_name, idempotency_key, COUNT(*) AS total FROM chain_write_operations GROUP BY tenant_id, operation_name, idempotency_key HAVING COUNT(*) > 1"
    ],
  ];

  let failures = 0;

  for (
    const [label, sql]
    of audits
  ) {
    const [rows] =
      await db.query(sql);

    console.log(
      label +
      " = " +
      rows.length
    );

    if (
      rows.length >
      0
    ) {
      failures += 1;

      console.table(
        rows
      );
    }
  }

  assert.equal(
    failures,
    0,
    "Write journal readiness invariants failed."
  );

  console.log();

  console.log(
    "WRITE JOURNAL READINESS VERIFIED."
  );

  console.log(
    "No invalid, broken, duplicate, or pending recovery rows found."
  );

  console.log(
    "Confirmed writes do not retain serialized transactions."
  );
} finally {
  await db.end();
}
