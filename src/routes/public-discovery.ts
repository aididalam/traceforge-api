import type { FastifyInstance } from "fastify";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { readPublicPresentation, publicOrganization, publicTimestamp } from "../public-presentation.js";
import type { Presentation } from "../public-presentation.js";

interface Dependencies {
  db: Pick<Pool, "query">;
  chainId: number;
  contractAddress: string;
}

interface EntityParams {
  tenantId: string;
  entityId: string;
}

interface HistoryQuery {
  limit?: string;
  afterEventId?: string;
}

interface EntityRow extends RowDataPacket {
  tenant_id: string;
  entity_id: string;
  entity_type: string;
  entity_type_label: string | null;
  metadata_hash: string;
  current_state: string;
  current_state_label: string | null;
  current_custodian: string;
  closed: number | boolean;
  created_at: string | number;
  closed_at: string | number | null;
}

interface EventRow extends RowDataPacket {
  id: string | number;
  event_name: string;
  block_number: string | number;
  transaction_hash: string;
  transaction_index: number;
  log_index: number;
  event_type: string | null;
  event_type_label: string | null;
  state_after: string | null;
  state_after_label: string | null;
  link_type: string | null;
  link_type_label: string | null;
  metadata_hash: string | null;
  evidence_hash: string | null;
  occurred_at: string | null;
  organization_id: string | null;
  from_organization_id: string | null;
  to_organization_id: string | null;
}

const bytes32 = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } as const;
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const organizationSchema = {
  anyOf: [{ type: "null" }, { type: "object", additionalProperties: false,
    required: ["id", "name", "type"], properties: { id: bytes32, name: nullableString, type: nullableString } }],
} as const;
const productInfoSchema = {
  anyOf: [{ type: "null" }, { type: "object", additionalProperties: false,
    required: ["name", "description", "fields"], properties: {
      name: nullableString, description: nullableString,
      fields: { type: "array", maxItems: 32, items: { type: "object", additionalProperties: false,
        required: ["label", "value"], properties: { label: { type: "string", maxLength: 80 }, value: { type: "string", maxLength: 1000 } } } },
    } }],
} as const;
const entitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["tenantId", "entityId", "entityType", "entityTypeLabel", "metadataHash", "currentState", "currentStateLabel", "currentCustodian", "closed", "createdAt", "closedAt", "productInfo", "currentHolder"],
  properties: {
    tenantId: bytes32,
    entityId: bytes32,
    entityType: bytes32,
    entityTypeLabel: nullableString,
    metadataHash: bytes32,
    currentState: bytes32,
    currentStateLabel: nullableString,
    currentCustodian: bytes32,
    closed: { type: "boolean" },
    createdAt: { type: "string" },
    closedAt: nullableString,
    productInfo: productInfoSchema,
    currentHolder: organizationSchema,
  },
} as const;

const eventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["eventId", "eventName", "blockNumber", "transactionHash", "transactionIndex", "logIndex", "eventType", "eventTypeLabel", "stateAfter", "stateAfterLabel", "linkType", "linkTypeLabel", "metadataHash", "evidenceHash", "occurredAt", "organization", "transfer"],
  properties: {
    eventId: { type: "string" },
    eventName: { type: "string" },
    blockNumber: { type: "string" },
    transactionHash: bytes32,
    transactionIndex: { type: "integer" },
    logIndex: { type: "integer" },
    eventType: nullableString,
    eventTypeLabel: nullableString,
    stateAfter: nullableString,
    stateAfterLabel: nullableString,
    linkType: nullableString,
    linkTypeLabel: nullableString,
    metadataHash: nullableString,
    evidenceHash: nullableString,
    occurredAt: nullableString,
    organization: organizationSchema,
    transfer: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false,
      required: ["from", "to"], properties: { from: organizationSchema, to: organizationSchema } }] },
  },
} as const;

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tenantId", "entityId"],
  properties: { tenantId: bytes32, entityId: bytes32 },
} as const;

function apiError(code: string, message: string) {
  return { error: { code, message } };
}

function entityResponse(row: EntityRow, presentation: Presentation) {
  return {
    tenantId: row.tenant_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    entityTypeLabel: row.entity_type_label,
    metadataHash: row.metadata_hash,
    currentState: row.current_state,
    currentStateLabel: row.current_state_label,
    currentCustodian: row.current_custodian,
    closed: Boolean(row.closed),
    createdAt: String(row.created_at),
    closedAt: row.closed_at === null ? null : String(row.closed_at),
    productInfo: presentation.productInfo,
    currentHolder: publicOrganization(row.current_custodian, presentation),
  };
}

function pagination(query: HistoryQuery) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  const afterEventId = BigInt(query.afterEventId ?? "0");
  if (afterEventId < 0n || afterEventId > 18446744073709551615n) {
    throw new Error("afterEventId must be an unsigned 64-bit integer");
  }
  return { limit, afterEventId };
}

export async function registerPublicDiscoveryRoutes(app: FastifyInstance, dependencies: Dependencies) {
  const { db, chainId } = dependencies;
  const contractAddress = dependencies.contractAddress.toLowerCase();
  const scope = [chainId, contractAddress];

  async function publishedEntity(params: EntityParams): Promise<EntityRow | null> {
    const [rows] = await db.query<EntityRow[]>(
      `SELECT e.tenant_id, e.entity_id, e.entity_type,
              et.display_label AS entity_type_label, e.metadata_hash,
              e.current_state, st.display_label AS current_state_label,
              e.current_custodian, e.closed,
              CAST(e.created_at AS CHAR) AS created_at,
              CAST(e.closed_at AS CHAR) AS closed_at
       FROM public_entity_publications p
       JOIN entities e ON e.tenant_id = p.tenant_id AND e.entity_id = p.entity_id
       LEFT JOIN semantic_registry et ON et.chain_id = ? AND et.contract_address = ?
         AND et.semantic_kind = 'entity_type' AND et.semantic_hash = e.entity_type
       LEFT JOIN semantic_registry st ON st.chain_id = ? AND st.contract_address = ?
         AND st.semantic_kind = 'state' AND st.semantic_hash = e.current_state
       WHERE p.tenant_id = ? AND p.entity_id = ?
       LIMIT 1`,
      [...scope, ...scope, params.tenantId.toLowerCase(), params.entityId.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  const route = "/public/v1/tenants/:tenantId/entities/:entityId";
  const commonSchema = {
    tags: ["public-discovery"],
    security: [],
    params: paramsSchema,
  };
  const errors = { 400: errorSchema, 404: errorSchema, 429: errorSchema };

  app.get<{ Params: EntityParams }>(route, {
    schema: {
      ...commonSchema,
      summary: "Read an explicitly published entity",
      description: "Public product status with separately approved display details and business names. Private metadata documents are not included. Missing and unpublished products both return 404.",
      response: { 200: entitySchema, ...errors },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const entity = await publishedEntity(request.params);
    if (!entity) {
      reply.code(404);
      return apiError("entity_not_found", "Entity was not found.");
    }
    const presentation = await readPublicPresentation(db, entity.tenant_id, entity.entity_id, entity.metadata_hash);
    return entityResponse(entity, presentation);
  });

  app.get<{ Params: EntityParams; Querystring: HistoryQuery }>(route + "/history", {
    schema: {
      ...commonSchema,
      summary: "Read published entity history",
      description: "Dated public supply history with separately approved business names, in ascending event-ID order. Private documents, wallets and raw arguments are excluded. Relationship events require both endpoints to be published; endpoint IDs are omitted.",
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "string", pattern: "^[0-9]{1,3}$" },
          afterEventId: { type: "string", pattern: "^[0-9]{1,20}$" },
        },
      },
      response: {
        ...errors,
        200: {
          type: "object",
          additionalProperties: false,
          required: ["tenantId", "entityId", "entity", "events", "page"],
          properties: {
            tenantId: bytes32,
            entityId: bytes32,
            entity: entitySchema,
            events: { type: "array", items: eventSchema },
            page: {
              type: "object",
              additionalProperties: false,
              required: ["limit", "hasMore", "nextAfterEventId"],
              properties: { limit: { type: "integer" }, hasMore: { type: "boolean" }, nextAfterEventId: nullableString },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    let page;
    try {
      page = pagination(request.query);
    } catch (error) {
      reply.code(400);
      return apiError("invalid_pagination", error instanceof Error ? error.message : "Invalid pagination.");
    }
    const entity = await publishedEntity(request.params);
    if (!entity) {
      reply.code(404);
      return apiError("entity_not_found", "Entity was not found.");
    }

    const [rows] = await db.query<EventRow[]>(
      `SELECT CAST(ce.id AS CHAR) AS id, ce.event_name,
              CAST(ce.block_number AS CHAR) AS block_number, ce.transaction_hash,
              ce.transaction_index, ce.log_index,
              JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.eventType')) AS event_type,
              ev.display_label AS event_type_label,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.stateAfter')),
                       JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.initialState'))) AS state_after,
              st.display_label AS state_after_label,
              JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.linkType')) AS link_type,
              lt.display_label AS link_type_label,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.metadataHashAfter')),
                       JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.metadataHash'))) AS metadata_hash,
              JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.evidenceHash')) AS evidence_hash,
              CASE ce.event_name
                WHEN 'EntityCreated' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.createdAt'))
                WHEN 'TraceRecorded' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.timestamp'))
                WHEN 'CustodyTransferProposed' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.proposedAt'))
                WHEN 'CustodyTransferred' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.acceptedAt'))
                WHEN 'CustodyTransferCancelled' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.cancelledAt'))
                WHEN 'CustodyTransferCancelledByAdmin' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.cancelledAt'))
                WHEN 'EntityLinkCreated' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.createdAt'))
                WHEN 'EntityLinkStatusChanged' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.updatedAt'))
                WHEN 'EntityClosed' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.closedAt'))
              END AS occurred_at,
              CASE ce.event_name
                WHEN 'CustodyTransferProposed' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.fromOrganizationId'))
                WHEN 'CustodyTransferCancelled' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.fromOrganizationId'))
                WHEN 'CustodyTransferred' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.toOrganizationId'))
                WHEN 'CustodyTransferCancelledByAdmin' THEN NULL
                ELSE JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.organizationId'))
              END AS organization_id,
              CASE WHEN ce.event_name IN ('CustodyTransferProposed','CustodyTransferred','CustodyTransferCancelled','CustodyTransferCancelledByAdmin')
                THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.fromOrganizationId')) END AS from_organization_id,
              CASE WHEN ce.event_name IN ('CustodyTransferProposed','CustodyTransferred','CustodyTransferCancelled','CustodyTransferCancelledByAdmin')
                THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.toOrganizationId')) END AS to_organization_id
       FROM chain_events ce
       JOIN public_entity_publications p ON p.tenant_id = ? AND p.entity_id = ?
         AND p.tenant_id = JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.tenantId'))
       LEFT JOIN semantic_registry ev ON ev.chain_id = ce.chain_id AND ev.contract_address = ce.contract_address
         AND ev.semantic_kind = 'event_type' AND ev.semantic_hash = JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.eventType'))
       LEFT JOIN semantic_registry st ON st.chain_id = ce.chain_id AND st.contract_address = ce.contract_address
         AND st.semantic_kind = 'state' AND st.semantic_hash = COALESCE(
           JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.stateAfter')),
           JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.initialState')))
       LEFT JOIN semantic_registry lt ON lt.chain_id = ce.chain_id AND lt.contract_address = ce.contract_address
         AND lt.semantic_kind = 'link_type' AND lt.semantic_hash = JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.linkType'))
       WHERE ce.chain_id = ? AND ce.contract_address = ? AND ce.id > CAST(? AS UNSIGNED)
         AND (
           JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.entityId')) = p.entity_id
           OR (
             (JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.sourceEntityId')) = p.entity_id
              OR JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.targetEntityId')) = p.entity_id)
             AND EXISTS (
               SELECT 1 FROM public_entity_publications source_publication
               JOIN public_entity_publications target_publication ON target_publication.tenant_id = source_publication.tenant_id
               WHERE source_publication.tenant_id = p.tenant_id
                 AND source_publication.entity_id = JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.sourceEntityId'))
                 AND target_publication.entity_id = JSON_UNQUOTE(JSON_EXTRACT(ce.event_args, '$.targetEntityId'))
             )
           )
         )
       ORDER BY ce.id
       LIMIT ?`,
      [entity.tenant_id, entity.entity_id, ...scope, page.afterEventId.toString(), page.limit + 1],
    );
    const hasMore = rows.length > page.limit;
    const visible = rows.slice(0, page.limit);
    const presentation = await readPublicPresentation(db, entity.tenant_id, entity.entity_id, entity.metadata_hash);
    return {
      tenantId: entity.tenant_id,
      entityId: entity.entity_id,
      entity: entityResponse(entity, presentation),
      events: visible.map(row => ({
        eventId: String(row.id),
        eventName: row.event_name,
        blockNumber: String(row.block_number),
        transactionHash: row.transaction_hash,
        transactionIndex: row.transaction_index,
        logIndex: row.log_index,
        eventType: row.event_type,
        eventTypeLabel: row.event_type_label,
        stateAfter: row.state_after,
        stateAfterLabel: row.state_after_label,
        linkType: row.link_type,
        linkTypeLabel: row.link_type_label,
        metadataHash: row.metadata_hash,
        evidenceHash: row.evidence_hash,
        occurredAt: publicTimestamp(row.occurred_at),
        organization: publicOrganization(row.organization_id, presentation),
        transfer: row.from_organization_id || row.to_organization_id ? {
          from: publicOrganization(row.from_organization_id, presentation),
          to: publicOrganization(row.to_organization_id, presentation),
        } : null,
      })),
      page: {
        limit: page.limit,
        hasMore,
        nextAfterEventId: hasMore ? String(visible[visible.length - 1].id) : null,
      },
    };
  });
}
