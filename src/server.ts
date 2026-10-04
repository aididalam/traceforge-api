import Fastify from "fastify";

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

app.get(
  "/health",
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

      return {
        database:
          "unavailable",
        status:
          "not-ready",
      };
    }
  },
);

app.get<{
  Params: EntityParams;
}>(
  "/v1/tenants/:tenantId/entities/:entityId",
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

      return {
        error:
          "invalid_identifier",
      };
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

      return {
        error:
          "entity_not_found",
      };
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
}>(
  "/v1/tenants/:tenantId/entities/:entityId/history",
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

      return {
        error:
          "invalid_identifier",
      };
    }

    const [entityRows] =
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
      entityRows.length ===
      0
    ) {
      reply.code(
        404,
      );

      return {
        error:
          "entity_not_found",
      };
    }

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
          WHERE JSON_UNQUOTE(
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
            block_number,
            transaction_index,
            log_index,
            id
        `,
        [
          tenantId,
          entityId,
          entityId,
          entityId,
        ],
      );

    return {
      tenantId,
      entityId,

      events:
        rows.map(
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
    };
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
