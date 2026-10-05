import type { FastifyInstance } from "fastify";
import type { Pool, RowDataPacket } from "mysql2/promise";

interface TrackingRow extends RowDataPacket { tracking_id: string; tenant_id: string; entity_id: string }
const bytes32 = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } as const;
const errorSchema = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: { error: { type: "object", additionalProperties: false, required: ["code", "message"],
    properties: { code: { type: "string" }, message: { type: "string" } } } },
} as const;

export async function registerPublicTrackingRoutes(app: FastifyInstance, { db }: { db: Pick<Pool, "query"> }) {
  app.get<{ Params: { trackingId: string } }>("/public/v1/tracking/:trackingId", {
    schema: {
      tags: ["public-discovery"], security: [], summary: "Resolve a published product by its global tracking ID",
      params: { type: "object", additionalProperties: false, required: ["trackingId"], properties: { trackingId: bytes32 } },
      response: {
        200: { type: "object", additionalProperties: false, required: ["trackingId", "tenantId", "entityId"],
          properties: { trackingId: bytes32, tenantId: bytes32, entityId: bytes32 } },
        400: errorSchema, 404: errorSchema, 429: errorSchema, 503: errorSchema,
      },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.url.includes("?")) {
      reply.code(400);
      return { error: { code: "invalid_request", message: "Tracking lookup does not accept query parameters." } };
    }
    try {
      const [rows] = await db.query<TrackingRow[]>(
        `SELECT CONCAT('0x', LOWER(HEX(t.tracking_id))) AS tracking_id, t.tenant_id, t.entity_id
         FROM public_entity_tracking_ids t
         JOIN public_entity_publications p ON p.tenant_id = t.tenant_id AND p.entity_id = t.entity_id
         JOIN entities e ON e.tenant_id = p.tenant_id AND e.entity_id = p.entity_id
         WHERE t.tracking_id = UNHEX(SUBSTRING(?, 3)) LIMIT 1`,
        [request.params.trackingId.toLowerCase()],
      );
      if (!rows[0]) {
        reply.code(404);
        return { error: { code: "entity_not_found", message: "Entity was not found." } };
      }
      return { trackingId: rows[0].tracking_id, tenantId: rows[0].tenant_id, entityId: rows[0].entity_id };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ER_NO_SUCH_TABLE") {
        reply.code(503);
        return { error: { code: "tracking_unavailable", message: "Public tracking is temporarily unavailable." } };
      }
      throw error;
    }
  });
}
