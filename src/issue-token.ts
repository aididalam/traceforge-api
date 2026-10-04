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

const allowedScopes =
  new Set([
    "tenant:read",
    "chain:write",
  ]);

interface TenantRow
  extends RowDataPacket {
  tenant_id: string;
}

interface MembershipRow
  extends RowDataPacket {
  organization_id: string;
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

function argumentsFor(
  name: string,
): string[] {
  const values: string[] =
    [];

  for (
    let index = 0;
    index <
    process.argv.length;
    index += 1
  ) {
    if (
      process.argv[index] ===
      name
    ) {
      const value =
        process.argv[
          index + 1
        ];

      if (
        value
      ) {
        values.push(
          value,
        );
      }
    }
  }

  return values;
}

const tenantId =
  argument(
    "--tenant",
  );

const organizationId =
  argument(
    "--organization",
  ) ??
  null;

const tokenName =
  argument(
    "--name",
  ) ??
  "local-dev";

const output =
  argument(
    "--output",
  );

const requestedScopes =
  argumentsFor(
    "--scope",
  );

const scopes =
  requestedScopes.length >
  0
    ? [
        ...new Set(
          requestedScopes,
        ),
      ]
    : [
        "tenant:read",
      ];

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
  organizationId &&
  !/^0x[0-9a-fA-F]{64}$/.test(
    organizationId,
  )
) {
  throw new Error(
    "--organization must be a bytes32 organization ID",
  );
}

for (
  const scope of scopes
) {
  if (
    !allowedScopes.has(
      scope,
    )
  ) {
    throw new Error(
      `Unsupported scope: ${scope}`,
    );
  }
}

if (
  scopes.includes(
    "chain:write",
  ) &&
  !organizationId
) {
  throw new Error(
    "chain:write tokens must be bound to an organization",
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

if (
  organizationId
) {
  const [memberships] =
    await db.query<
      MembershipRow[]
    >(
      `
        SELECT organization_id
        FROM tenant_memberships
        WHERE tenant_id = ?
          AND organization_id = ?
          AND active = TRUE
        LIMIT 1
      `,
      [
        tenantId,
        organizationId,
      ],
    );

  if (
    memberships.length ===
    0
  ) {
    throw new Error(
      "Organization is not an active member of the tenant.",
    );
  }
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
      organization_id,
      token_name,
      scopes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  [
    tokenId,
    tokenHash,
    tokenHint,
    tenantId.toLowerCase(),
    organizationId
      ? organizationId.toLowerCase()
      : null,
    tokenName,
    JSON.stringify(
      scopes,
    ),
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
  `Organization: ${organizationId ?? "none"}`,
);

console.log(
  `Scopes: ${scopes.join(", ")}`,
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
