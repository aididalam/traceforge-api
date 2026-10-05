import {
  createHash,
} from "node:crypto";

import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import type {
  RowDataPacket,
} from "mysql2";

import {
  config,
} from "./config.js";

import {
  db,
} from "./db.js";

export type ApiScope =
  | "tenant:read"
  | "chain:write";

export interface AuthContext {
  tokenId: string;
  tenantId: string;
  organizationId: string | null;
  tokenName: string;
  scopes: ApiScope[];
}

interface TokenRow
  extends RowDataPacket {
  token_id: string;
  tenant_id: string;
  organization_id:
    | string
    | null;
  token_name: string;
  scopes:
    | string
    | ApiScope[];
}

const authContexts =
  new WeakMap<
    FastifyRequest,
    AuthContext
  >();

function apiError(
  code: string,
  message: string,
) {
  return {
    error: {
      code,
      message,
    },
  };
}

function parseScopes(
  value:
    | string
    | ApiScope[],
): ApiScope[] {
  const parsed =
    typeof value ===
    "string"
      ? JSON.parse(
          value,
        )
      : value;

  if (
    !Array.isArray(
      parsed,
    )
  ) {
    throw new Error(
      "Stored API token scopes are invalid.",
    );
  }

  return parsed as ApiScope[];
}

function bearerToken(
  request: FastifyRequest,
): string | null {
  const header =
    request.headers.authorization;

  if (
    !header
  ) {
    return null;
  }

  const match =
    /^Bearer\s+(.+)$/i.exec(
      header,
    );

  if (
    !match
  ) {
    return null;
  }

  return match[1];
}

export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Fastify resolves percent-encoded static paths before invoking the hook.
  // Protect the matched route, including URLs such as /v%31/tenants/....
  const routePath = request.routeOptions.url ?? request.url;

  if (
    !routePath.startsWith(
      "/v1/",
    )
  ) {
    return;
  }

  const token =
    bearerToken(
      request,
    );

  if (
    !token
  ) {
    reply
      .header(
        "WWW-Authenticate",
        "Bearer",
      )
      .code(
        401,
      )
      .send(
        apiError(
          "authentication_required",
          "A valid bearer token is required.",
        ),
      );

    return;
  }

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

  const [rows] =
    await db.query<
      TokenRow[]
    >(
      `
        SELECT
          token_id,
          tenant_id,
          organization_id,
          token_name,
          scopes
        FROM api_auth_tokens
        WHERE token_hash = ?
          AND active = TRUE
          AND (
            expires_at IS NULL
            OR expires_at > CURRENT_TIMESTAMP
          )
        LIMIT 1
      `,
      [
        tokenHash,
      ],
    );

  if (
    rows.length ===
    0
  ) {
    reply
      .header(
        "WWW-Authenticate",
        "Bearer",
      )
      .code(
        401,
      )
      .send(
        apiError(
          "invalid_token",
          "Bearer token is invalid or inactive.",
        ),
      );

    return;
  }

  const row =
    rows[0];

  const context: AuthContext = {
    tokenId:
      row.token_id,

    tenantId:
      row.tenant_id.toLowerCase(),

    organizationId:
      row.organization_id
        ? row.organization_id.toLowerCase()
        : null,

    tokenName:
      row.token_name,

    scopes:
      parseScopes(
        row.scopes,
      ),
  };

  authContexts.set(
    request,
    context,
  );

  const params =
    request.params as
      | {
          tenantId?: string;
        }
      | undefined;

  const routeTenantId =
    params?.tenantId;

  if (
    routeTenantId &&
    routeTenantId.toLowerCase() !==
      context.tenantId
  ) {
    reply
      .code(
        403,
      )
      .send(
        apiError(
          "tenant_access_denied",
          "The authenticated token cannot access this tenant.",
        ),
      );

    return;
  }
}

export function authContextFor(
  request: FastifyRequest,
): AuthContext {
  const context =
    authContexts.get(
      request,
    );

  if (
    !context
  ) {
    throw new Error(
      "Authenticated request context is unavailable.",
    );
  }

  return context;
}

export function requireScope(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: ApiScope,
): boolean {
  const context =
    authContextFor(
      request,
    );

  if (
    context.scopes.includes(
      scope,
    )
  ) {
    return true;
  }

  reply
    .code(
      403,
    )
    .send(
      apiError(
        "insufficient_scope",
        `Required API scope: ${scope}`,
      ),
    );

  return false;
}

export async function tenantCanAccessDocument(
  tenantId: string,
  contentHash: string,
): Promise<boolean> {
  const [rows] =
    await db.query<
      RowDataPacket[]
    >(
      `
        SELECT 1
        FROM offchain_documents d
        WHERE d.content_hash = ?
          AND (
            EXISTS (
              SELECT 1
              FROM tenants t
              WHERE t.tenant_id = ?
                AND t.metadata_hash =
                    d.content_hash
            )
            OR EXISTS (
              SELECT 1
              FROM entities e
              WHERE e.tenant_id = ?
                AND e.metadata_hash =
                    d.content_hash
            )
            OR EXISTS (
              SELECT 1
              FROM roles r
              WHERE r.tenant_id = ?
                AND r.metadata_hash =
                    d.content_hash
            )
            OR EXISTS (
              SELECT 1
              FROM tenant_memberships m
              JOIN organizations o
                ON o.organization_id =
                   m.organization_id
              WHERE m.tenant_id = ?
                AND o.metadata_hash =
                    d.content_hash
            )
            OR EXISTS (
              SELECT 1
              FROM chain_events ce
              WHERE ce.chain_id = ?
                AND ce.contract_address = ?
                AND JSON_UNQUOTE(
                      JSON_EXTRACT(
                        ce.event_args,
                        '$.tenantId'
                      )
                    ) = ?
                AND (
                  JSON_UNQUOTE(
                    JSON_EXTRACT(
                      ce.event_args,
                      '$.metadataHash'
                    )
                  ) = d.content_hash
                  OR
                  JSON_UNQUOTE(
                    JSON_EXTRACT(
                      ce.event_args,
                      '$.metadataHashAfter'
                    )
                  ) = d.content_hash
                  OR
                  JSON_UNQUOTE(
                    JSON_EXTRACT(
                      ce.event_args,
                      '$.evidenceHash'
                    )
                  ) = d.content_hash
                )
            )
          )
        LIMIT 1
      `,
      [
        contentHash.toLowerCase(),
        tenantId,
        tenantId,
        tenantId,
        tenantId,
        config.traceforge.chainId,
        config.traceforge.contractAddress,
        tenantId,
      ],
    );

  return rows.length > 0;
}
