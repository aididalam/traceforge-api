import "dotenv/config";

import assert from "node:assert/strict";

import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  homedir,
  tmpdir,
} from "node:os";

import {
  basename,
  join,
} from "node:path";

import {
  spawnSync,
} from "node:child_process";

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

function run(
  command,
  args,
  options = {},
) {
  const result =
    spawnSync(
      command,
      args,
      {
        encoding:
          "utf8",
        ...options,
      },
    );

  if (
    result.status !== 0
  ) {
    throw new Error(
      command +
      " failed with exit " +
      result.status +
      "\n" +
      (
        result.stderr ??
        ""
      )
    );
  }

  return result;
}

const host =
  required(
    "MYSQL_HOST"
  );

const port =
  Number(
    required(
      "MYSQL_PORT"
    )
  );

const database =
  required(
    "MYSQL_DATABASE"
  );

const user =
  required(
    "MYSQL_USER"
  );

const password =
  required(
    "MYSQL_PASSWORD"
  );

assert.ok(
  Number.isSafeInteger(
    port
  ) &&
  port > 0,
  "MYSQL_PORT must be a positive integer."
);

assert.match(
  database,
  /^[A-Za-z0-9_]+$/,
  "MYSQL_DATABASE contains unsupported characters."
);

const restoreDatabase =
  database +
  "_restore_verify_" +
  process.pid;

const backupDir =
  join(
    homedir(),
    ".traceforge",
    "backups",
    "mysql",
  );

mkdirSync(
  backupDir,
  {
    recursive:
      true,
    mode:
      0o700,
  },
);

chmodSync(
  backupDir,
  0o700,
);

const stamp =
  new Date()
    .toISOString()
    .replaceAll(
      ":",
      "-"
    )
    .replaceAll(
      ".",
      "-"
    );

const backupFile =
  join(
    backupDir,
    database +
    "-" +
    stamp +
    ".sql",
  );

const tempDir =
  mkdtempSync(
    join(
      tmpdir(),
      "traceforge-mysql-"
    )
  );

const defaultsFile =
  join(
    tempDir,
    "client.cnf"
  );

writeFileSync(
  defaultsFile,
  [
    "[client]",
    "host=" + host,
    "port=" + port,
    "user=" + user,
    "password=" + password,
    "",
  ].join("\n"),
  {
    mode:
      0o600,
  },
);

chmodSync(
  defaultsFile,
  0o600,
);

const sourceDb =
  await mysql.createConnection({
    host,
    port,
    database,
    user,
    password,
  });

let adminDb;

try {
  const [tables] =
    await sourceDb.query(
      "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ? ORDER BY TABLE_NAME",
      [
        database,
        "BASE TABLE",
      ]
    );

  assert.ok(
    tables.length > 0,
    "Source database has no base tables."
  );

  const sourceCounts =
    new Map();

  for (
    const row
    of tables
  ) {
    const table =
      row.tableName;

    if (
      !/^[A-Za-z0-9_]+$/.test(
        table
      )
    ) {
      throw new Error(
        "Unsafe table name: " +
        table
      );
    }

    const [rows] =
      await sourceDb.query(
        "SELECT COUNT(*) AS total FROM \`" +
        table +
        "\`"
      );

    sourceCounts.set(
      table,
      String(
        rows[0].total
      )
    );
  }

  console.log(
    "source_tables =",
    tables.length
  );

  const dump =
    run(
      "mysqldump",
      [
        "--defaults-extra-file=" +
          defaultsFile,

        "--single-transaction",
        "--quick",
        "--routines",
        "--triggers",
        "--events",
        "--hex-blob",
        "--no-tablespaces",
        "--set-gtid-purged=OFF",
        database,
      ]
    );

  assert.ok(
    dump.stdout.length > 0,
    "mysqldump produced an empty backup."
  );

  writeFileSync(
    backupFile,
    dump.stdout,
    {
      mode:
        0o600,
    },
  );

  chmodSync(
    backupFile,
    0o600,
  );

  console.log(
    "backup_created =",
    basename(
      backupFile
    )
  );

  adminDb =
    await mysql.createConnection({
      host,
      port,
      user,
      password,
    });

  await adminDb.query(
    "DROP DATABASE IF EXISTS \`" +
    restoreDatabase +
    "\`"
  );

  await adminDb.query(
    "CREATE DATABASE \`" +
    restoreDatabase +
    "\` CHARACTER SET utf8mb4"
  );

  const backupSql =
    readFileSync(
      backupFile,
      "utf8"
    );

  run(
    "mysql",
    [
      "--defaults-extra-file=" +
        defaultsFile,

      restoreDatabase,
    ],
    {
      input:
        backupSql,
    },
  );

  const restoredDb =
    await mysql.createConnection({
      host,
      port,
      database:
        restoreDatabase,
      user,
      password,
    });

  try {
    const [restoredTables] =
      await restoredDb.query(
        "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ? ORDER BY TABLE_NAME",
        [
          restoreDatabase,
          "BASE TABLE",
        ]
      );

    assert.deepEqual(
      restoredTables.map(
        (row) =>
          row.tableName
      ),
      tables.map(
        (row) =>
          row.tableName
      ),
      "Restored table set differs from source."
    );

    for (
      const row
      of restoredTables
    ) {
      const table =
        row.tableName;

      const [rows] =
        await restoredDb.query(
          "SELECT COUNT(*) AS total FROM \`" +
          table +
          "\`"
        );

      const restoredCount =
        String(
          rows[0].total
        );

      assert.equal(
        restoredCount,
        sourceCounts.get(
          table
        ),
        "Row-count mismatch for table " +
        table
      );
    }

    console.log(
      "restored_tables =",
      restoredTables.length
    );

    console.log(
      "row_count_mismatches = 0"
    );

    console.log();

    console.log(
      "MYSQL BACKUP RESTORE VERIFIED."
    );

    console.log(
      "Live database was not overwritten."
    );

    console.log(
      "Backup file permissions are owner-only."
    );
  } finally {
    await restoredDb.end();
  }
} finally {
  if (
    adminDb
  ) {
    try {
      await adminDb.query(
        "DROP DATABASE IF EXISTS \`" +
        restoreDatabase +
        "\`"
      );
    } finally {
      await adminDb.end();
    }
  }

  await sourceDb.end();

  rmSync(
    tempDir,
    {
      recursive:
        true,
      force:
        true,
    },
  );
}
