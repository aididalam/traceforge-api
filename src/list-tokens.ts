import type {
  RowDataPacket,
} from "mysql2";

import {
  db,
} from "./db.js";

interface TokenRow
  extends RowDataPacket {
  token_id: string;
  token_hint: string;
  tenant_id: string;
  organization_id:
    | string
    | null;
  token_name: string;
  scopes:
    | string
    | unknown[];
  active: number | boolean;
  expires_at:
    | Date
    | string
    | null;
  created_at:
    | Date
    | string;
}

const [rows] =
  await db.query<
    TokenRow[]
  >(
    `
      SELECT
        token_id,
        token_hint,
        tenant_id,
        organization_id,
        token_name,
        scopes,
        active,
        expires_at,
        created_at
      FROM api_auth_tokens
      ORDER BY created_at
    `,
  );

console.table(
  rows.map(
    (row) => ({
      tokenId:
        row.token_id,
      hint:
        row.token_hint,
      tenantId:
        row.tenant_id,
      organizationId:
        row.organization_id,
      name:
        row.token_name,
      scopes:
        typeof row.scopes ===
        "string"
          ? row.scopes
          : JSON.stringify(
              row.scopes,
            ),
      active:
        Boolean(
          row.active,
        ),
      expiresAt:
        row.expires_at,
      createdAt:
        row.created_at,
    }),
  ),
);

await db.end();
