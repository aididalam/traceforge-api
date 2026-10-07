import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";

import type {
  RowDataPacket,
} from "mysql2";

import {
  config,
} from "./config.js";

import {
  db,
} from "./db.js";

import {
  authContextFor,
  authHook,
  tenantCanAccessDocument,
} from "./auth.js";

import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerPublicDiscoveryRoutes } from "./routes/public-discovery.js";
import { registerPublicTrackingRoutes } from "./routes/public-tracking.js";
import { registerPublicShortLinkRoutes } from "./routes/public-short-links.js";
import { registerPublicProductRoutes } from "./routes/public-products.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { businessActions } from "./business.js";
import { registerOperatorRoutes } from "./routes/operator.js";
import { registerErpRoutes } from "./routes/erp.js";
import {createErpKey,listErpKeys,revokeErpKey} from "./erp.js";
import { registerPreflightRoutes } from "./routes/preflight.js";
import { registerGenericWriteSimulationRoutes } from "./routes/generic-write-simulate.js";
import { registerGenericWriteBroadcastRoutes } from "./routes/generic-write-broadcast.js";

const app =
  Fastify({
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.password",
          "req.body.invitationCode",
        ],
        censor:
          "[REDACTED]",
      },
    },
  });

await app.register(
  helmet,
  {
    contentSecurityPolicy:
      false,
  },
);

await app.register(
  rateLimit,
  {
    global:
      true,

    max:
      120,

    timeWindow:
      "1 minute",

    allowList:
      (request) => {
        // Use the router's template so encoded prefixes share the same budget.
        const routePath = request.routeOptions.url ?? request.url;
        return !routePath.startsWith("/v1/") && !routePath.startsWith("/public/") && !routePath.startsWith("/operator/") && !routePath.startsWith("/integration/");
      },

    errorResponseBuilder:
      (_request, context) => {
        const error =
          new Error(
            "Rate limit exceeded. Retry in " +
            context.after +
            ".",
          ) as Error & {
            statusCode: number;
            code: string;
          };

        error.statusCode =
          context.statusCode;

        error.code =
          "rate_limit_exceeded";

        return error;
      },
  },
);

interface EntityRow
  extends RowDataPacket {
  tenant_id: string;
  entity_id: string;
  entity_type: string;
  entity_type_label:
    | string
    | null;
  metadata_hash: string;
  current_state: string;
  current_state_label:
    | string
    | null;
  current_custodian: string;
  closed: number | boolean;
  created_at: string | number;
  closed_at:
    | string
    | number
    | null;
  metadata_document:
    | string
    | Record<string, unknown>
    | null;
}

interface EventRow
  extends RowDataPacket {
  id: string | number;
  event_name: string;
  event_args:
    | string
    | Record<string, unknown>;
  block_number: string | number;
  transaction_hash: string;
  transaction_index: number;
  log_index: number;
  metadata_hash:
    | string
    | null;
  evidence_hash:
    | string
    | null;
  event_type:
    | string
    | null;
  event_type_label:
    | string
    | null;
  state_after:
    | string
    | null;
  state_after_label:
    | string
    | null;
  link_type:
    | string
    | null;
  link_type_label:
    | string
    | null;
  metadata_document:
    | string
    | Record<string, unknown>
    | null;
  evidence_document:
    | string
    | Record<string, unknown>
    | null;
}

interface DocumentRow
  extends RowDataPacket {
  content_hash: string;
  document_kind: string;
  source_ref: string;
  byte_length: string | number;
  document_json:
    | string
    | Record<string, unknown>;
  imported_at: Date | string;
}

interface EntityParams {
  tenantId: string;
  entityId: string;
}

interface DocumentParams {
  contentHash: string;
}

interface HistoryQuery {
  limit?: string;
  afterEventId?: string;
}

const bytes32Pattern =
  "^0x[0-9a-fA-F]{64}$";

const errorResponseSchema = {
  type:
    "object",

  required: [
    "error",
  ],

  properties: {
    error: {
      type:
        "object",

      required: [
        "code",
        "message",
      ],

      properties: {
        code: {
          type:
            "string",
        },

        message: {
          type:
            "string",
        },
      },
    },
  },
} as const;

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

function isBytes32(
  value: string,
): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(
    value,
  );
}

function parseJsonObject(
  value:
    | string
    | Record<string, unknown>
    | null,
): Record<string, unknown> | null {
  if (
    value ===
    null
  ) {
    return null;
  }

  if (
    typeof value ===
    "string"
  ) {
    return JSON.parse(
      value,
    ) as Record<
      string,
      unknown
    >;
  }

  return value;
}

function parseEventArgs(
  value:
    | string
    | Record<string, unknown>,
): Record<string, unknown> {
  const parsed =
    parseJsonObject(
      value,
    );

  if (
    parsed ===
    null
  ) {
    throw new Error(
      "Event args cannot be null.",
    );
  }

  return parsed;
}

function parseLimit(
  value: string | undefined,
): number {
  if (
    value ===
    undefined
  ) {
    return 50;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed,
    ) ||
    parsed < 1 ||
    parsed > 100
  ) {
    throw new Error(
      "limit must be an integer between 1 and 100",
    );
  }

  return parsed;
}

function parseAfterEventId(
  value: string | undefined,
): bigint {
  if (
    value ===
    undefined
  ) {
    return 0n;
  }

  if (
    !/^[0-9]+$/.test(
      value,
    )
  ) {
    throw new Error(
      "afterEventId must be an unsigned integer",
    );
  }

  return BigInt(
    value,
  );
}

await app.register(
  swagger,
  {
    openapi: {
      info: {
        title:
          "TraceForge API",

        description:
          "Tenant-scoped HTTP API over the TraceForge indexed MySQL read model.",

        version:
          "0.18.0",
      },
      components: { securitySchemes: { operatorSession: { type: "http", scheme: "bearer", description: "Short-lived business account session, held by the operator gateway." }, erpKey: {type:"http",scheme:"bearer",description:"Revocable, scoped ERP integration key."} } },
    },
  },
);

await app.register(
  swaggerUi,
  {
    routePrefix:
      "/docs",
  },
);

app.setErrorHandler(
  (
    error,
    request,
    reply,
  ) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      reply
        .code(
          429,
        )
        .send(
          apiError(
            "rate_limit_exceeded",
            error instanceof Error
              ? error.message
              : "Rate limit exceeded.",
          ),
        );

      return;
    }

    request.log.error(
      error,
    );

    if (
      reply.sent
    ) {
      return;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      error.validation
    ) {
      reply
        .code(
          400,
        )
        .send(
          apiError(
            "invalid_request",
            error instanceof Error
              ? error.message
              : "Request validation failed.",
          ),
        );

      return;
    }

    reply
      .code(
        500,
      )
      .send(
        apiError(
          "internal_error",
          "Internal server error.",
        ),
      );
  },
);

app.addHook(
  "preHandler",
  authHook,
);

app.get(
  "/health",
  {
    schema: {
      tags: [
        "system",
      ],

      response: {
        200: {
          type:
            "object",

          required: [
            "service",
            "status",
          ],

          properties: {
            service: {
              type:
                "string",
            },

            status: {
              type:
                "string",
            },
          },
        },
      },
    },
  },
  async () => {
    return {
      service:
        "traceforge-api",
      status:
        "ok",
    };
  },
);

app.get(
  "/ready",
  {
    schema: {
      tags: [
        "system",
      ],

      response: {
        200: {
          type:
            "object",

          required: [
            "database",
            "status",
          ],

          properties: {
            database: {
              type:
                "string",
            },

            status: {
              type:
                "string",
            },
          },
        },

        503:
          errorResponseSchema,
      },
    },
  },
  async (
    _request,
    reply,
  ) => {
    try {
      await db.query(
        "SELECT 1",
      );

      return {
        database:
          "ok",
        status:
          "ready",
      };
    } catch {
      reply.code(
        503,
      );

      return apiError(
        "database_unavailable",
        "Database is unavailable.",
      );
    }
  },
);

app.get<{
  Params: DocumentParams;
}>(
  "/v1/documents/:contentHash",
  {
    schema: {
      tags: [
        "documents",
      ],

      params: {
        type:
          "object",

        required: [
          "contentHash",
        ],

        properties: {
          contentHash: {
            type:
              "string",
            pattern:
              bytes32Pattern,
          },
        },
      },

      response: {
        400:
          errorResponseSchema,

        404:
          errorResponseSchema,
      },
    },
  },
  async (
    request,
    reply,
  ) => {
    const {
      contentHash,
    } =
      request.params;

    if (
      !isBytes32(
        contentHash,
      )
    ) {
      reply.code(
        400,
      );

      return apiError(
        "invalid_identifier",
        "contentHash must be a bytes32 hex value.",
      );
    }

    const auth =
      authContextFor(
        request,
      );

    if (
      !await tenantCanAccessDocument(
        auth.tenantId,
        contentHash,
      )
    ) {
      reply.code(
        404,
      );

      return apiError(
        "document_not_found",
        "Off-chain document was not found.",
      );
    }

    const [rows] =
      await db.query<
        DocumentRow[]
      >(
        `
          SELECT
            content_hash,
            document_kind,
            source_ref,
            byte_length,
            document_json,
            imported_at
          FROM offchain_documents
          WHERE content_hash = ?
        `,
        [
          contentHash,
        ],
      );

    if (
      rows.length ===
      0
    ) {
      reply.code(
        404,
      );

      return apiError(
        "document_not_found",
        "Off-chain document was not found.",
      );
    }

    const row =
      rows[0];

    return {
      contentHash:
        row.content_hash,

      documentKind:
        row.document_kind,

      sourceRef:
        row.source_ref,

      byteLength:
        String(
          row.byte_length,
        ),

      document:
        parseJsonObject(
          row.document_json,
        ),

      importedAt:
        row.imported_at instanceof Date
          ? row.imported_at.toISOString()
          : String(
              row.imported_at,
            ),
    };
  },
);

app.get<{
  Params: EntityParams;
}>(
  "/v1/tenants/:tenantId/entities/:entityId",
  {
    schema: {
      tags: [
        "entities",
      ],

      params: {
        type:
          "object",

        required: [
          "tenantId",
          "entityId",
        ],

        properties: {
          tenantId: {
            type:
              "string",
            pattern:
              bytes32Pattern,
          },

          entityId: {
            type:
              "string",
            pattern:
              bytes32Pattern,
          },
        },
      },

      response: {
        400:
          errorResponseSchema,

        404:
          errorResponseSchema,
      },
    },
  },
  async (
    request,
    reply,
  ) => {
    const {
      tenantId,
      entityId,
    } =
      request.params;

    if (
      !isBytes32(
        tenantId,
      ) ||
      !isBytes32(
        entityId,
      )
    ) {
      reply.code(
        400,
      );

      return apiError(
        "invalid_identifier",
        "tenantId and entityId must be bytes32 hex values.",
      );
    }

    const [rows] =
      await db.query<
        EntityRow[]
      >(
        `
          SELECT
            e.tenant_id,
            e.entity_id,
            e.entity_type,
            et.display_label
              AS entity_type_label,
            e.metadata_hash,
            e.current_state,
            st.display_label
              AS current_state_label,
            e.current_custodian,
            e.closed,
            e.created_at,
            e.closed_at,
            d.document_json
              AS metadata_document

          FROM entities e

          LEFT JOIN offchain_documents d
            ON d.content_hash =
               e.metadata_hash

          LEFT JOIN semantic_registry et
            ON et.chain_id = ?
           AND et.contract_address = ?
           AND et.semantic_kind =
               'entity_type'
           AND et.semantic_hash =
               e.entity_type

          LEFT JOIN semantic_registry st
            ON st.chain_id = ?
           AND st.contract_address = ?
           AND st.semantic_kind =
               'state'
           AND st.semantic_hash =
               e.current_state

          WHERE e.tenant_id = ?
            AND e.entity_id = ?
        `,
        [
          config.traceforge.chainId,
          config.traceforge.contractAddress,
          config.traceforge.chainId,
          config.traceforge.contractAddress,
          tenantId,
          entityId,
        ],
      );

    if (
      rows.length ===
      0
    ) {
      reply.code(
        404,
      );

      return apiError(
        "entity_not_found",
        "Entity was not found.",
      );
    }

    const entity =
      rows[0];

    return {
      tenantId:
        entity.tenant_id,

      entityId:
        entity.entity_id,

      entityType:
        entity.entity_type,

      entityTypeLabel:
        entity.entity_type_label,

      metadataHash:
        entity.metadata_hash,

      metadata:
        parseJsonObject(
          entity.metadata_document,
        ),

      currentState:
        entity.current_state,

      currentStateLabel:
        entity.current_state_label,

      currentCustodian:
        entity.current_custodian,

      closed:
        Boolean(
          entity.closed,
        ),

      createdAt:
        String(
          entity.created_at,
        ),

      closedAt:
        entity.closed_at ===
        null
          ? null
          : String(
              entity.closed_at,
            ),
    };
  },
);

app.get<{
  Params: EntityParams;
  Querystring: HistoryQuery;
}>(
  "/v1/tenants/:tenantId/entities/:entityId/history",
  {
    schema: {
      tags: [
        "entities",
      ],

      params: {
        type:
          "object",

        required: [
          "tenantId",
          "entityId",
        ],

        properties: {
          tenantId: {
            type:
              "string",
            pattern:
              bytes32Pattern,
          },

          entityId: {
            type:
              "string",
            pattern:
              bytes32Pattern,
          },
        },
      },

      querystring: {
        type:
          "object",

        properties: {
          limit: {
            type:
              "string",
          },

          afterEventId: {
            type:
              "string",
          },
        },
      },

      response: {
        400:
          errorResponseSchema,

        404:
          errorResponseSchema,
      },
    },
  },
  async (
    request,
    reply,
  ) => {
    const {
      tenantId,
      entityId,
    } =
      request.params;

    if (
      !isBytes32(
        tenantId,
      ) ||
      !isBytes32(
        entityId,
      )
    ) {
      reply.code(
        400,
      );

      return apiError(
        "invalid_identifier",
        "tenantId and entityId must be bytes32 hex values.",
      );
    }

    let limit: number;
    let afterEventId: bigint;

    try {
      limit =
        parseLimit(
          request.query.limit,
        );

      afterEventId =
        parseAfterEventId(
          request.query.afterEventId,
        );
    } catch (
      error
    ) {
      reply.code(
        400,
      );

      return apiError(
        "invalid_pagination",
        error instanceof Error
          ? error.message
          : "Invalid pagination.",
      );
    }

    const [entityRows] =
      await db.query<
        EntityRow[]
      >(
        `
          SELECT
            e.tenant_id,
            e.entity_id,
            e.entity_type,
            et.display_label
              AS entity_type_label,
            e.metadata_hash,
            e.current_state,
            st.display_label
              AS current_state_label,
            e.current_custodian,
            e.closed,
            e.created_at,
            e.closed_at,
            d.document_json
              AS metadata_document

          FROM entities e

          LEFT JOIN offchain_documents d
            ON d.content_hash =
               e.metadata_hash

          LEFT JOIN semantic_registry et
            ON et.chain_id = ?
           AND et.contract_address = ?
           AND et.semantic_kind =
               'entity_type'
           AND et.semantic_hash =
               e.entity_type

          LEFT JOIN semantic_registry st
            ON st.chain_id = ?
           AND st.contract_address = ?
           AND st.semantic_kind =
               'state'
           AND st.semantic_hash =
               e.current_state

          WHERE e.tenant_id = ?
            AND e.entity_id = ?
        `,
        [
          config.traceforge.chainId,
          config.traceforge.contractAddress,
          config.traceforge.chainId,
          config.traceforge.contractAddress,
          tenantId,
          entityId,
        ],
      );

    if (
      entityRows.length ===
      0
    ) {
      reply.code(
        404,
      );

      return apiError(
        "entity_not_found",
        "Entity was not found.",
      );
    }

    const fetchLimit =
      limit + 1;

    const [rows] =
      await db.query<
        EventRow[]
      >(
        `
          SELECT
            ce.id,
            ce.event_name,
            ce.event_args,
            ce.block_number,
            ce.transaction_hash,
            ce.transaction_index,
            ce.log_index,

            COALESCE(
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  ce.event_args,
                  '$.metadataHashAfter'
                )
              ),
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  ce.event_args,
                  '$.metadataHash'
                )
              )
            ) AS metadata_hash,

            JSON_UNQUOTE(
              JSON_EXTRACT(
                ce.event_args,
                '$.evidenceHash'
              )
            ) AS evidence_hash,

            JSON_UNQUOTE(
              JSON_EXTRACT(
                ce.event_args,
                '$.eventType'
              )
            ) AS event_type,

            ev.display_label
              AS event_type_label,

            COALESCE(
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  ce.event_args,
                  '$.stateAfter'
                )
              ),
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  ce.event_args,
                  '$.initialState'
                )
              )
            ) AS state_after,

            state_sem.display_label
              AS state_after_label,

            JSON_UNQUOTE(
              JSON_EXTRACT(
                ce.event_args,
                '$.linkType'
              )
            ) AS link_type,

            link_sem.display_label
              AS link_type_label,

            md.document_json
              AS metadata_document,

            ed.document_json
              AS evidence_document

          FROM chain_events ce

          LEFT JOIN offchain_documents md
            ON md.content_hash =
               COALESCE(
                 JSON_UNQUOTE(
                   JSON_EXTRACT(
                     ce.event_args,
                     '$.metadataHashAfter'
                   )
                 ),
                 JSON_UNQUOTE(
                   JSON_EXTRACT(
                     ce.event_args,
                     '$.metadataHash'
                   )
                 )
               )

          LEFT JOIN offchain_documents ed
            ON ed.content_hash =
               JSON_UNQUOTE(
                 JSON_EXTRACT(
                   ce.event_args,
                   '$.evidenceHash'
                 )
               )

          LEFT JOIN semantic_registry ev
            ON ev.chain_id = ?
           AND ev.contract_address = ?
           AND ev.semantic_kind =
               'event_type'
           AND ev.semantic_hash =
               JSON_UNQUOTE(
                 JSON_EXTRACT(
                   ce.event_args,
                   '$.eventType'
                 )
               )

          LEFT JOIN semantic_registry state_sem
            ON state_sem.chain_id = ?
           AND state_sem.contract_address = ?
           AND state_sem.semantic_kind =
               'state'
           AND state_sem.semantic_hash =
               COALESCE(
                 JSON_UNQUOTE(
                   JSON_EXTRACT(
                     ce.event_args,
                     '$.stateAfter'
                   )
                 ),
                 JSON_UNQUOTE(
                   JSON_EXTRACT(
                     ce.event_args,
                     '$.initialState'
                   )
                 )
               )

          LEFT JOIN semantic_registry link_sem
            ON link_sem.chain_id = ?
           AND link_sem.contract_address = ?
           AND link_sem.semantic_kind =
               'link_type'
           AND link_sem.semantic_hash =
               JSON_UNQUOTE(
                 JSON_EXTRACT(
                   ce.event_args,
                   '$.linkType'
                 )
               )

          WHERE ce.chain_id = ?
            AND ce.contract_address = ?
            AND ce.id > ?
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
                  '$.entityId'
                )
              ) = ?
              OR
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  ce.event_args,
                  '$.sourceEntityId'
                )
              ) = ?
              OR
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  ce.event_args,
                  '$.targetEntityId'
                )
              ) = ?
            )

          ORDER BY
            ce.id

          LIMIT ?
        `,
        [
          config.traceforge.chainId,
          config.traceforge.contractAddress,
          config.traceforge.chainId,
          config.traceforge.contractAddress,
          config.traceforge.chainId,
          config.traceforge.contractAddress,
          config.traceforge.chainId,
          config.traceforge.contractAddress,
          afterEventId.toString(),
          tenantId,
          entityId,
          entityId,
          entityId,
          fetchLimit,
        ],
      );

    const hasMore =
      rows.length >
      limit;

    const pageRows =
      hasMore
        ? rows.slice(
            0,
            limit,
          )
        : rows;

    const last =
      pageRows[
        pageRows.length -
          1
      ];

    const entity =
      entityRows[0];

    return {
      tenantId,
      entityId,

      entity: {
        entityType:
          entity.entity_type,

        entityTypeLabel:
          entity.entity_type_label,

        metadataHash:
          entity.metadata_hash,

        metadata:
          parseJsonObject(
            entity.metadata_document,
          ),

        currentState:
          entity.current_state,

        currentStateLabel:
          entity.current_state_label,

        currentCustodian:
          entity.current_custodian,

        closed:
          Boolean(
            entity.closed,
          ),
      },

      events:
        pageRows.map(
          (row) => ({
            eventId:
              String(
                row.id,
              ),

            eventName:
              row.event_name,

            args:
              parseEventArgs(
                row.event_args,
              ),

            eventType:
              row.event_type,

            eventTypeLabel:
              row.event_type_label,

            stateAfter:
              row.state_after,

            stateAfterLabel:
              row.state_after_label,

            linkType:
              row.link_type,

            linkTypeLabel:
              row.link_type_label,

            metadataHash:
              row.metadata_hash,

            metadata:
              parseJsonObject(
                row.metadata_document,
              ),

            evidenceHash:
              row.evidence_hash,

            evidence:
              parseJsonObject(
                row.evidence_document,
              ),

            blockNumber:
              String(
                row.block_number,
              ),

            transactionHash:
              row.transaction_hash,

            transactionIndex:
              row.transaction_index,

            logIndex:
              row.log_index,
          }),
        ),

      page: {
        limit,

        hasMore,

        nextAfterEventId:
          hasMore &&
          last
            ? String(
                last.id,
              )
            : null,
      },
    };
  },
);

await registerAuthRoutes(app);
await registerOperatorRoutes(app, { db, chainId: config.traceforge.chainId, contractAddress: config.traceforge.contractAddress, actions: businessActions,
  keyActions:{create:createErpKey,list:listErpKeys,revoke:revokeErpKey} });
await registerErpRoutes(app);
await registerPreflightRoutes(app);
await registerGenericWriteSimulationRoutes(app);
await registerGenericWriteBroadcastRoutes(app);
await registerDiscoveryRoutes(app);
await registerPublicTrackingRoutes(app, { db });
await registerPublicShortLinkRoutes(app, { db });
await registerPublicProductRoutes(app,{db,chainId:config.traceforge.chainId,contractAddress:config.traceforge.contractAddress});
await registerPublicDiscoveryRoutes(app, {
  db,
  chainId: config.traceforge.chainId,
  contractAddress: config.traceforge.contractAddress,
});

app.get(
  "/openapi.json",
  {
    schema: {
      hide:
        true,
    },
  },
  async () => {
    return app.swagger();
  },
);

async function shutdown() {
  await app.close();
  await db.end();
}

process.on(
  "SIGINT",
  async () => {
    await shutdown();
    process.exit(
      0,
    );
  },
);

process.on(
  "SIGTERM",
  async () => {
    await shutdown();
    process.exit(
      0,
    );
  },
);

await app.listen({
  host:
    config.host,

  port:
    config.port,
});
