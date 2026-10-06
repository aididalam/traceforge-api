import {
  readdir,
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import type {
  RowDataPacket,
} from "mysql2";

import {
  db,
} from "./db.js";
import {backfillBusinessCodes} from "./business-codes.js";

interface MigrationRow
  extends RowDataPacket {
  migration_name: string;
}

function splitStatements(
  sql: string,
): string[] {
  return sql
    .split(";")
    .map(
      (statement) =>
        statement.trim(),
    )
    .filter(
      (statement) =>
        statement.length > 0,
    );
}

const migrationsDir =
  resolve(
    "migrations",
  );

await db.query(
  `
    CREATE TABLE IF NOT EXISTS api_schema_migrations (
      migration_name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (
        migration_name
      )
    )
  `,
);

const entries =
  (
    await readdir(
      migrationsDir,
      {
        withFileTypes:
          true,
      },
    )
  )
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(
          ".sql",
        ),
    )
    .map(
      (entry) =>
        entry.name,
    )
    .sort();

for (
  const name of entries
) {
  const [rows] =
    await db.query<
      MigrationRow[]
    >(
      `
        SELECT migration_name
        FROM api_schema_migrations
        WHERE migration_name = ?
      `,
      [
        name,
      ],
    );

  if (
    rows.length > 0
  ) {
    console.log(
      `SKIP  ${name}`,
    );

    continue;
  }

  const sql =
    await readFile(
      resolve(
        migrationsDir,
        name,
      ),
      "utf8",
    );

  const statements =
    splitStatements(
      sql,
    );

  if (
    statements.length ===
    0
  ) {
    throw new Error(
      `Migration is empty: ${name}`,
    );
  }

  const connection =
    await db.getConnection();

  try {
    for (
      const statement of statements
    ) {
      await connection.query(
        statement,
      );
    }

    await connection.query(
      `
        INSERT INTO api_schema_migrations (
          migration_name
        )
        VALUES (?)
      `,
      [
        name,
      ],
    );

    console.log(
      `APPLY ${name}`,
    );
  } finally {
    connection.release();
  }
}

try {
  const count=await backfillBusinessCodes(db);
  console.log(`Business code reservations verified for ${count} businesses.`);
} finally {await db.end();}

console.log();
console.log(
  "API migrations complete.",
);
