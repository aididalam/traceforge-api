import type {
  FastifyInstance,
} from "fastify";

import type {
  RowDataPacket,
} from "mysql2";

import {
  config,
} from "../config.js";

import {
  db,
} from "../db.js";

interface TenantParams {
  tenantId: string;
}

interface PageQuery {
  limit?: string;
  afterEventId?: string;
}

interface TenantRow
  extends RowDataPacket {
  tenant_id: string;
}

interface EntityRow
  extends RowDataPacket {
  entity_id: string;
  entity_type: string;
  entity_type_label:
    | string
    | null;
  metadata_hash: string;
  metadata_document:
    | string
    | Record<string, unknown>
    | null;
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
  created_event_id: string | number;
}

interface OrganizationRow
  extends RowDataPacket {
  organization_id: string;
  metadata_hash: string;
  metadata_document:
    | string
    | Record<string, unknown>
    | null;
  organization_active:
    | number
    | boolean;
  membership_active:
    | number
    | boolean;
  created_at: string | number;
  joined_at: string | number;
  joined_event_id: string | number;
}

interface RelationshipRow
  extends RowDataPacket {
  link_id: string;
  source_entity_id: string;
  target_entity_id: string;
  link_type: string;
  link_type_label:
    | string
    | null;
  organization_id: string;
  active: number | boolean;
  created_at: string | number;
  created_event_id: string | number;
}

const bytes32Pattern =
  "^0x[0-9a-fA-F]{64}$";

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

function parseJsonObject(
  value:
    | string
    | Record<string, unknown>
    | null,
): Record<string, unknown> | null {
  if (
    value === null
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

function parseLimit(
  value: string | undefined,
): number {
  if (
    value === undefined
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
    value === undefined
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

function pageArgs(
  query: PageQuery,
): {
  limit: number;
  afterEventId: bigint;
} {
  return {
    limit:
      parseLimit(
        query.limit,
      ),

    afterEventId:
      parseAfterEventId(
        query.afterEventId,
      ),
  };
}

async function tenantExists(
  tenantId: string,
): Promise<boolean> {
  const [rows] =
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

  return rows.length > 0;
}

function pagination(
  limit: number,
  rows: {
    cursor: string | number;
  }[],
) {
  const hasMore =
    rows.length > limit;

  const pageRows =
    hasMore
      ? rows.slice(
          0,
          limit,
        )
      : rows;

  const last =
    pageRows[
      pageRows.length - 1
    ];

  return {
    hasMore,
    pageRows,

    page: {
      limit,

      hasMore,

      nextAfterEventId:
        hasMore &&
        last
          ? String(
              last.cursor,
            )
          : null,
    },
  };
}

export async function registerDiscoveryRoutes(
  app: FastifyInstance,
) {
  app.get<{
    Params: TenantParams;
    Querystring: PageQuery;
  }>(
    "/v1/tenants/:tenantId/entities",
    {
      schema: {
        tags: [
          "discovery",
        ],

        params: {
          type:
            "object",

          required: [
            "tenantId",
          ],

          properties: {
            tenantId: {
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
      },
    },
    async (
      request,
      reply,
    ) => {
      const {
        tenantId,
      } =
        request.params;

      let limit: number;
      let afterEventId: bigint;

      try {
        ({
          limit,
          afterEventId,
        } = pageArgs(
          request.query,
        ));
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

      if (
        !await tenantExists(
          tenantId,
        )
      ) {
        reply.code(
          404,
        );

        return apiError(
          "tenant_not_found",
          "Tenant was not found.",
        );
      }

      const [rows] =
        await db.query<
          EntityRow[]
        >(
          `
            SELECT
              e.entity_id,
              e.entity_type,
              et.display_label
                AS entity_type_label,
              e.metadata_hash,
              d.document_json
                AS metadata_document,
              e.current_state,
              st.display_label
                AS current_state_label,
              e.current_custodian,
              e.closed,
              e.created_at,
              e.closed_at,
              e.created_event_id

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
              AND e.created_event_id > ?

            ORDER BY
              e.created_event_id

            LIMIT ?
          `,
          [
            config.traceforge.chainId,
            config.traceforge.contractAddress,

            config.traceforge.chainId,
            config.traceforge.contractAddress,

            tenantId,
            afterEventId.toString(),
            limit + 1,
          ],
        );

      const mapped =
        rows.map(
          (row) => ({
            cursor:
              row.created_event_id,

            entityId:
              row.entity_id,

            entityType:
              row.entity_type,

            entityTypeLabel:
              row.entity_type_label,

            metadataHash:
              row.metadata_hash,

            metadata:
              parseJsonObject(
                row.metadata_document,
              ),

            currentState:
              row.current_state,

            currentStateLabel:
              row.current_state_label,

            currentCustodian:
              row.current_custodian,

            closed:
              Boolean(
                row.closed,
              ),

            createdAt:
              String(
                row.created_at,
              ),

            closedAt:
              row.closed_at ===
              null
                ? null
                : String(
                    row.closed_at,
                  ),
          }),
        );

      const result =
        pagination(
          limit,
          mapped,
        );

      return {
        tenantId,

        entities:
          result.pageRows.map(
            ({
              cursor: _cursor,
              ...entity
            }) => entity,
          ),

        page:
          result.page,
      };
    },
  );

  app.get<{
    Params: TenantParams;
    Querystring: PageQuery;
  }>(
    "/v1/tenants/:tenantId/organizations",
    {
      schema: {
        tags: [
          "discovery",
        ],

        params: {
          type:
            "object",

          required: [
            "tenantId",
          ],

          properties: {
            tenantId: {
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
      },
    },
    async (
      request,
      reply,
    ) => {
      const {
        tenantId,
      } =
        request.params;

      let limit: number;
      let afterEventId: bigint;

      try {
        ({
          limit,
          afterEventId,
        } = pageArgs(
          request.query,
        ));
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

      if (
        !await tenantExists(
          tenantId,
        )
      ) {
        reply.code(
          404,
        );

        return apiError(
          "tenant_not_found",
          "Tenant was not found.",
        );
      }

      const [rows] =
        await db.query<
          OrganizationRow[]
        >(
          `
            SELECT
              o.organization_id,
              o.metadata_hash,
              d.document_json
                AS metadata_document,
              o.active
                AS organization_active,
              m.active
                AS membership_active,
              o.created_at,
              m.joined_at,
              m.joined_event_id

            FROM tenant_memberships m

            JOIN organizations o
              ON o.organization_id =
                 m.organization_id

            LEFT JOIN offchain_documents d
              ON d.content_hash =
                 o.metadata_hash

            WHERE m.tenant_id = ?
              AND m.joined_event_id > ?

            ORDER BY
              m.joined_event_id

            LIMIT ?
          `,
          [
            tenantId,
            afterEventId.toString(),
            limit + 1,
          ],
        );

      const mapped =
        rows.map(
          (row) => ({
            cursor:
              row.joined_event_id,

            organizationId:
              row.organization_id,

            metadataHash:
              row.metadata_hash,

            metadata:
              parseJsonObject(
                row.metadata_document,
              ),

            organizationActive:
              Boolean(
                row.organization_active,
              ),

            membershipActive:
              Boolean(
                row.membership_active,
              ),

            createdAt:
              String(
                row.created_at,
              ),

            joinedAt:
              String(
                row.joined_at,
              ),
          }),
        );

      const result =
        pagination(
          limit,
          mapped,
        );

      return {
        tenantId,

        organizations:
          result.pageRows.map(
            ({
              cursor: _cursor,
              ...organization
            }) => organization,
          ),

        page:
          result.page,
      };
    },
  );

  app.get<{
    Params: TenantParams;
    Querystring: PageQuery;
  }>(
    "/v1/tenants/:tenantId/relationships",
    {
      schema: {
        tags: [
          "discovery",
        ],

        params: {
          type:
            "object",

          required: [
            "tenantId",
          ],

          properties: {
            tenantId: {
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
      },
    },
    async (
      request,
      reply,
    ) => {
      const {
        tenantId,
      } =
        request.params;

      let limit: number;
      let afterEventId: bigint;

      try {
        ({
          limit,
          afterEventId,
        } = pageArgs(
          request.query,
        ));
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

      if (
        !await tenantExists(
          tenantId,
        )
      ) {
        reply.code(
          404,
        );

        return apiError(
          "tenant_not_found",
          "Tenant was not found.",
        );
      }

      const [rows] =
        await db.query<
          RelationshipRow[]
        >(
          `
            SELECT
              l.link_id,
              l.source_entity_id,
              l.target_entity_id,
              l.link_type,
              sem.display_label
                AS link_type_label,
              l.organization_id,
              l.active,
              l.created_at,
              l.created_event_id

            FROM entity_links l

            LEFT JOIN semantic_registry sem
              ON sem.chain_id = ?
             AND sem.contract_address = ?
             AND sem.semantic_kind =
                 'link_type'
             AND sem.semantic_hash =
                 l.link_type

            WHERE l.tenant_id = ?
              AND l.created_event_id > ?

            ORDER BY
              l.created_event_id

            LIMIT ?
          `,
          [
            config.traceforge.chainId,
            config.traceforge.contractAddress,
            tenantId,
            afterEventId.toString(),
            limit + 1,
          ],
        );

      const mapped =
        rows.map(
          (row) => ({
            cursor:
              row.created_event_id,

            linkId:
              row.link_id,

            sourceEntityId:
              row.source_entity_id,

            targetEntityId:
              row.target_entity_id,

            linkType:
              row.link_type,

            linkTypeLabel:
              row.link_type_label,

            organizationId:
              row.organization_id,

            active:
              Boolean(
                row.active,
              ),

            createdAt:
              String(
                row.created_at,
              ),
          }),
        );

      const result =
        pagination(
          limit,
          mapped,
        );

      return {
        tenantId,

        relationships:
          result.pageRows.map(
            ({
              cursor: _cursor,
              ...relationship
            }) => relationship,
          ),

        page:
          result.page,
      };
    },
  );
}
