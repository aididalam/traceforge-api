import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OperatorPrincipal } from "../operator-data.js";
import type { createErpKey, listErpKeys, revokeErpKey } from "../erp.js";
import { ErpProblem, erpScopes, parseErpScopes, erpText } from "../erp-input.js";
import type { ErpScope } from "../erp-input.js";

export interface ErpKeyActions {create: typeof createErpKey; list: typeof listErpKeys; revoke: typeof revokeErpKey}
const noQuery = {type: "object", additionalProperties: false, properties: {}};
const problem = (code: string) => ({error: {code, message: "Check the integration request or access permissions."}});
export async function registerErpKeyRoutes(app: FastifyInstance, principal: (request: FastifyRequest) => OperatorPrincipal, actions?: ErpKeyActions) {
  app.post<{Body: {name: string; scopes: ErpScope[]; expiresInDays?: number}}>("/integration-keys", {
    bodyLimit: 4096,
    preValidation: async (request, reply) => {
      try {
        erpText(request.body?.name, 120); parseErpScopes(request.body?.scopes);
        const days = request.body?.expiresInDays;
        if (days !== undefined && (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365)) throw new Error("Invalid expiry.");
      } catch { return reply.code(400).send(problem("invalid_request")); }
    },
    schema: {tags: ["erp-keys"], security: [{operatorSession: []}], querystring: noQuery,
      body: {type: "object", additionalProperties: false, required: ["name", "scopes"], properties: {
        name: {type: "string", minLength: 1, maxLength: 120}, scopes: {type: "array", minItems: 1, maxItems: 5, uniqueItems: true, items: {type: "string", enum: erpScopes}},
        expiresInDays: {type: "integer", minimum: 1, maximum: 365}}}}}, async (request, reply) => {
    if (!actions) return reply.code(503).send(problem("integration_unavailable"));
    try { return reply.code(201).send(await actions.create(principal(request), request.body)); }
    catch (error) { if (error instanceof ErpProblem) return reply.code(error.status).send(problem(error.code)); throw error; }
  });
  app.get("/integration-keys", {schema: {tags: ["erp-keys"], security: [{operatorSession: []}], querystring: noQuery}}, (request, reply) => {
    return actions ? actions.list(principal(request)) : reply.code(503).send(problem("integration_unavailable"));
  });
  app.post<{Params: {keyId: string}}>("/integration-keys/:keyId/revoke", {
    schema: {tags: ["erp-keys"], security: [{operatorSession: []}], querystring: noQuery, params: {
      type: "object", additionalProperties: false, required: ["keyId"], properties: {
        keyId: {type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"}}}}}, async (request, reply) => {
    if (!actions) return reply.code(503).send(problem("integration_unavailable"));
    try { return await actions.revoke(principal(request), request.params.keyId); }
    catch (error) { if (error instanceof ErpProblem) return reply.code(error.status).send(problem(error.code)); throw error; }
  });
}
