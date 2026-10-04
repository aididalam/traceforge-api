import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import type {
  RowDataPacket,
} from "mysql2";

import {
  config,
} from "./config.js";

import {
  db,
} from "./db.js";

const app =
  Fastify({
    logger: true,
  });

interface EntityRow
  extends RowDataPacket {
  tenant_id: string;
  entity_id: string;
  entity_type: string;
  metadata_hash: string;
  current_state: string;
  current_custodian: string;
  closed: number | boolean;
  created_at: string | number;
  closed_at:
    | string
    | number
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
}

interface EntityParams {
  tenantId: string;
  entityId: string;
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

function parseEventArgs(
  value:
    | string
    | Record<string, unknown>,
): Record<string, unknown> {
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
          "0.2.0",
      },
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
            tenant_id,
            entity_id,
            entity_type,
            metadata_hash,
            current_state,
            current_custodian,
            closed,
            created_at,
            closed_at
          FROM entities
          WHERE tenant_id = ?
            AND entity_id = ?
        `,
        [
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

      metadataHash:
        entity.metadata_hash,

      currentState:
        entity.current_state,

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
            entity_id
          FROM entities
          WHERE tenant_id = ?
            AND entity_id = ?
        `,
        [
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
            id,
            event_name,
            event_args,
            block_number,
            transaction_hash,
            transaction_index,
            log_index
          FROM chain_events
          WHERE chain_id = ?
            AND contract_address = ?
            AND id > ?
            AND JSON_UNQUOTE(
                  JSON_EXTRACT(
                    event_args,
                    '$.tenantId'
                  )
                ) = ?
            AND (
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  event_args,
                  '$.entityId'
                )
              ) = ?
              OR
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  event_args,
                  '$.sourceEntityId'
                )
              ) = ?
              OR
              JSON_UNQUOTE(
                JSON_EXTRACT(
                  event_args,
                  '$.targetEntityId'
                )
              ) = ?
            )
          ORDER BY
            id
          LIMIT ?
        `,
        [
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

    return {
      tenantId,
      entityId,

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
