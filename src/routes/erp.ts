import type { FastifyInstance, FastifyRequest } from "fastify";
import { products } from "../operator-data.js";
import { receiveLookup, productReference } from "../business.js";
import { productRoutes, searchProductReferences } from "../product-quantity.js";
import { db } from "../db.js";
import { authenticateErp, enqueueErpJob, getErpJob, ErpProblem, erpScope } from "../erp.js";
import type { ErpPrincipal } from "../erp.js";
import { erpProductCode, parseErpBatch } from "../erp-input.js";
import type { ErpScope, ErpBatch } from "../erp-input.js";
import {listReceiptRequests,decideReceiptRequests} from '../receipt-requests.js';
import {receiptDecisions} from '../receipt-input.js';
import {BusinessProblem} from '../business-write.js';

const uuid = {type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"};
const noQuery = {type: "object", additionalProperties: false, properties: {}};
const problem = (code: string) => ({error: {code, message: "Check the integration request or access permissions."}});
export async function registerErpRoutes(app: FastifyInstance) {
  await app.register(async erp => {
    const principals = new WeakMap<FastifyRequest, ErpPrincipal>(), batches = new WeakMap<FastifyRequest, ErpBatch>();
    const principal = (request: FastifyRequest) => principals.get(request)!;
    erp.addHook("onRequest", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });
    erp.setErrorHandler((error, _request, reply) => {
      if (error instanceof ErpProblem) return reply.code(error.status).send(problem(error.code));
      if (error instanceof BusinessProblem) return reply.code(error.status).send(problem(error.code));
      const value = error as {validation?: unknown; statusCode?: number; code?: string; status?: number};
      if (value.statusCode === 429) return reply.header("Retry-After", "60").code(429).send(problem("rate_limit_exceeded"));
      if (value.validation || value.statusCode === 400) return reply.code(400).send(problem("invalid_request"));
      if (value.statusCode === 413) return reply.code(413).send(problem("request_too_large"));
      if (value.code === "product_not_found") return reply.code(404).send(problem("product_not_found"));
      // SQL errors may contain secrets or product metadata. Do not log or echo them.
      return reply.code(503).send(problem("integration_unavailable"));
    });
    erp.addHook("preValidation", async (request, reply) => {
      const route = request.routeOptions.url ?? "", query = new URL(request.url, "http://erp.local").searchParams;
      const allowed = route.endsWith("/scan") ? ["code"] : route.endsWith("/search") ? ["id", "businessCode", "after", "limit"] :
        route.endsWith("/receipt-requests")?['direction','after','limit']:route.endsWith("/products") || route.endsWith("/routes") ? ["after", "limit"] : [];
      if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1))
        return reply.code(400).send(problem("invalid_request"));
      try {
        if (request.method === "POST" && route.endsWith("/jobs")) batches.set(request, parseErpBatch(request.body));
        else if(request.method==='POST'&&route.endsWith('/receipt-requests/decisions'))receiptDecisions(request.body);
        else if (request.body !== undefined) throw new Error("Unexpected body.");
      } catch { return reply.code(400).send(problem("invalid_request")); }
    });
    erp.addHook("preHandler", async (request, reply) => {
      const identity = await authenticateErp(request.headers.authorization);
      if (!identity) return reply.header("WWW-Authenticate", "Bearer").code(401).send(problem("authentication_required"));
      const route = request.routeOptions.url ?? "";
      const scope: ErpScope | null = route.endsWith('/receipt-requests/decisions')?'products:approve':route.includes("/jobs") ? "jobs:read" : route.endsWith("/me") ? null : "products:read";
      if (scope && !identity.scopes.includes(scope)) return reply.code(403).send(problem("insufficient_scope"));
      principals.set(request, identity);
    });
    const security = [{erpKey: []}], page = {after: {type: "string", pattern: "^(0|[1-9][0-9]{0,19})$"}, limit: {type: "string", pattern: "^[0-9]{1,3}$"}};
    const pagination = (query: {after?: string; limit?: string}) => {
      const after = query.after ?? "0", limit = Number(query.limit ?? 50);
      if (BigInt(after) > 18446744073709551615n || limit < 1 || limit > 100) throw new ErpProblem("invalid_request");
      return {after, limit};
    };
    erp.get("/me", {schema: {tags: ["erp"], security, querystring: noQuery}}, request => ({keyId: principal(request).keyId,
      organizationId: principal(request).operator.organizationId, scopes: principal(request).scopes}));
    erp.get<{Querystring: {code: string}}>("/scan", {schema: {tags: ["erp"], security, querystring: {
      type: "object", additionalProperties: false, required: ["code"], properties: {code: {type: "string", minLength: 1, maxLength: 2048}}}}}, request => {
      let code: string;
      try { code = erpProductCode(request.query.code); } catch { throw new ErpProblem("invalid_request"); }
      return receiveLookup(principal(request).operator, code);
    });
    erp.get<{Querystring: {after?: string; limit?: string}}>("/products", {schema: {tags: ["erp"], security, querystring: {
      type: "object", additionalProperties: false, properties: page}}}, request => {
      const p = pagination(request.query);
      return products(db, principal(request).operator, [...erpScope], p.after, p.limit);
    });
    erp.get<{Querystring: {id: string; businessCode?: string; after?: string; limit?: string}}>("/products/search", {
      schema: {tags: ["erp"], security, querystring: {type: "object", additionalProperties: false, required: ["id"], properties: {
        ...page, id: {type: "string", minLength: 1, maxLength: 120}, businessCode: {type: "string", minLength: 1, maxLength: 16}}}}}, request => {
      const p = pagination(request.query);
      return searchProductReferences(db, [...erpScope], request.query.id, request.query.businessCode, p.after, p.limit, principal(request).operator.organizationId);
    });
    erp.get<{Params: {trackingId: string}; Querystring: {after?: string; limit?: string}}>("/products/:trackingId/routes", {
      schema: {tags: ["erp"], security, params: {type: "object", additionalProperties: false, required: ["trackingId"], properties: {
        trackingId: {type: "string", pattern: "^0x[0-9a-fA-F]{64}$"}}}, querystring: {type: "object", additionalProperties: false, properties: page}}}, async request => {
      const p = pagination(request.query), ref = await productReference(request.params.trackingId);
      return productRoutes(db, [...erpScope], ref.tenant_id, ref.entity_id, p.after, p.limit);
    });
    erp.post("/jobs", {bodyLimit: 1024 * 1024, schema: {tags: ["erp"], security, querystring: noQuery,
      body: {type: "object", additionalProperties: false, required: ["idempotencyKey", "operations"], properties: {
        idempotencyKey: {type: "string", pattern: "^[A-Za-z0-9_-]{8,64}$"},
        reference: {type: "string", minLength: 1, maxLength: 120},
        occurredAt: {type: "string", description: "ERP event time in ISO UTC; blockchain confirmation time is recorded separately."},
        operations: {type: "array", minItems: 1, maxItems: 100, items: {type: "object", additionalProperties: false,
          required: ["action", "idempotencyKey", "data"], properties: {
            action: {type: "string", enum: ["create", "receive", "remove"]},
            idempotencyKey: {type: "string", pattern: "^[A-Za-z0-9_-]{8,64}$"},
            productCode: {type: "string", maxLength: 2048, description: "Existing TraceForge short code, full Tracking ID or /s/ or /track/ URL."},
            data: {type: "object", description: "Existing registration, receipt or removal data. Receipt/removal must explicitly set confirmed=true. Batch operations require their source/owned route."}}}}}}}}, async (request, reply) => {
      return reply.code(202).send(await enqueueErpJob(principal(request), batches.get(request)!));
    });
    erp.get<{Params: {jobId: string}}>("/jobs/:jobId", {schema: {tags: ["erp"], security, querystring: noQuery, params: {
      type: "object", additionalProperties: false, required: ["jobId"], properties: {jobId: uuid}}}}, request => getErpJob(principal(request), request.params.jobId));
    erp.get<{Querystring:{direction?:'incoming'|'outgoing';after?:string;limit?:string}}>('/receipt-requests',{
      schema:{tags:['erp'],security,querystring:{type:'object',additionalProperties:false,properties:{...page,direction:{type:'string',enum:['incoming','outgoing']}}}}
    },request=>{const p=pagination(request.query);return listReceiptRequests(principal(request).operator,request.query.direction??'incoming',p.after,p.limit);});
    erp.post('/receipt-requests/decisions',{
      bodyLimit:16384,schema:{tags:['erp'],security,querystring:noQuery,body:{type:'object',additionalProperties:false,required:['requestIds','action','idempotencyKey'],properties:{
        requestIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:uuid},action:{type:'string',enum:['approve','decline','cancel']},idempotencyKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,64}$'}}}}
    },async(request,reply)=>reply.code(202).send(await decideReceiptRequests(principal(request).operator,request.body)));
  }, {prefix: "/integration/v1"});
}
