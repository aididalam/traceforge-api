import type { FastifyInstance } from "fastify";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { normalizeShortCode, shortCodeParamPattern } from "../public-short-links.js";

interface ShortRow extends RowDataPacket { short_code: string; tracking_id: string; tenant_id: string; entity_id: string }
const bytes32 = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } as const;
const errorSchema = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: { error: { type: "object", additionalProperties: false, required: ["code", "message"],
    properties: { code: { type: "string" }, message: { type: "string" } } } },
} as const;

export async function registerPublicShortLinkRoutes(app: FastifyInstance, { db }: { db: Pick<Pool, "query"> }) {
  app.get<{ Params: { shortCode: string } }>("/public/v1/short-links/:shortCode", {
    schema: {
      tags: ["public-discovery"], security: [], summary: "Resolve a published product's short tracking code",
      params: { type: "object", additionalProperties: false, required: ["shortCode"],
        properties: { shortCode: { type: "string", pattern: shortCodeParamPattern } } },
      response: {
        200: { type: "object", additionalProperties: false, required: ["shortCode", "trackingId", "tenantId", "entityId"],
          properties: { shortCode: { type: "string", pattern: shortCodeParamPattern }, trackingId: bytes32, tenantId: bytes32, entityId: bytes32 } },
        400: errorSchema, 404: errorSchema, 429: errorSchema, 503: errorSchema,
      },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const code = normalizeShortCode(request.params.shortCode);
    if (!code || request.url.includes("?")) {
      reply.code(400);
      return { error: { code: "invalid_request", message: "Invalid short tracking lookup." } };
    }
    try {
      const [rows] = await db.query<ShortRow[]>(
        `SELECT s.short_code, CONCAT('0x', LOWER(HEX(t.tracking_id))) AS tracking_id, t.tenant_id, t.entity_id
         FROM public_entity_short_links s
         JOIN public_entity_tracking_ids t ON t.tracking_id = s.tracking_id
         JOIN public_entity_publications p ON p.tenant_id = t.tenant_id AND p.entity_id = t.entity_id
         JOIN entities e ON e.tenant_id = p.tenant_id AND e.entity_id = p.entity_id
         WHERE s.short_code = ? LIMIT 1`, [code]);
      if (!rows[0]) {
        reply.code(404);
        return { error: { code: "entity_not_found", message: "Entity was not found." } };
      }
      return { shortCode: rows[0].short_code, trackingId: rows[0].tracking_id, tenantId: rows[0].tenant_id, entityId: rows[0].entity_id };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ER_NO_SUCH_TABLE") {
        reply.code(503);
        return { error: { code: "tracking_unavailable", message: "Public tracking is temporarily unavailable." } };
      }
      throw error;
    }
  });
}
