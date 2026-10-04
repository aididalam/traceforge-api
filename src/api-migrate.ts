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

interface MigrationRow
  extends RowDataPacket {
  migration_name: string;
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

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      sql,
    );

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

    await connection.commit();

    console.log(
      `APPLY ${name}`,
    );
  } catch (
    error
  ) {
    await connection.rollback();

    throw error;
  } finally {
    connection.release();
  }
}

await db.end();

console.log();
console.log(
  "API migrations complete.",
);
