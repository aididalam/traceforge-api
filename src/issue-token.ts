import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import {
  chmod,
  mkdir,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
  resolve,
} from "node:path";

import type {
  RowDataPacket,
} from "mysql2";

import {
  db,
} from "./db.js";

interface TenantRow
  extends RowDataPacket {
  tenant_id: string;
}

function argument(
  name: string,
): string | undefined {
  const index =
    process.argv.indexOf(
      name,
    );

  if (
    index < 0
  ) {
    return undefined;
  }

  return process.argv[
    index + 1
  ];
}

const tenantId =
  argument(
    "--tenant",
  );

const tokenName =
  argument(
    "--name",
  ) ??
  "local-dev";

const output =
  argument(
    "--output",
  );

if (
  !tenantId ||
  !/^0x[0-9a-fA-F]{64}$/.test(
    tenantId,
  )
) {
  throw new Error(
    "--tenant must be a bytes32 tenant ID",
  );
}

if (
  !output
) {
  throw new Error(
    "--output is required so the plaintext token is written to a protected local file instead of printed",
  );
}

const [tenants] =
  await db.query<
    TenantRow[]
  >(
    `
      SELECT tenant_id
      FROM tenants
      WHERE tenant_id = ?
      LIMIT 1
    `,
    [
      tenantId,
    ],
  );

if (
  tenants.length === 0
) {
  throw new Error(
    "Tenant does not exist in the indexed read model.",
  );
}

const token =
  `tfk_${randomBytes(
    32,
  ).toString(
    "base64url",
  )}`;

const tokenHash =
  createHash(
    "sha256",
  )
    .update(
      token,
      "utf8",
    )
    .digest(
      "hex",
    );

const tokenId =
  randomUUID();

const tokenHint =
  `${token.slice(
    0,
    8,
  )}...${token.slice(
    -4,
  )}`;

await db.query(
  `
    INSERT INTO api_auth_tokens (
      token_id,
      token_hash,
      token_hint,
      tenant_id,
      token_name
    )
    VALUES (?, ?, ?, ?, ?)
  `,
  [
    tokenId,
    tokenHash,
    tokenHint,
    tenantId.toLowerCase(),
    tokenName,
  ],
);

const outputPath =
  resolve(
    output.replace(
      /^~(?=\/)/,
      process.env.HOME ??
        "",
    ),
  );

await mkdir(
  dirname(
    outputPath,
  ),
  {
    recursive:
      true,
    mode:
      0o700,
  },
);

await writeFile(
  outputPath,
  token + "\n",
  {
    mode:
      0o600,
  },
);

await chmod(
  outputPath,
  0o600,
);

await db.end();

console.log(
  `Issued tenant-scoped API token: ${tokenId}`,
);

console.log(
  `Tenant: ${tenantId}`,
);

console.log(
  `Name: ${tokenName}`,
);

console.log(
  `Hint: ${tokenHint}`,
);

console.log(
  `Token written to: ${outputPath}`,
);

console.log(
  "Plaintext token was not printed.",
);
