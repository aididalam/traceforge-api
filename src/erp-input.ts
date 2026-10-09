import { productRegistration, productQuantity, removalInput } from "./product-input.js";
import type { ProductField } from "./product-metadata.js";

export class ErpProblem extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}

export const erpScopes = ["products:read", "products:create", "products:receive", "products:remove", "products:approve", "jobs:read"] as const;
export type ErpScope = typeof erpScopes[number];
export const maxErpOperations = 100;
export const pendingErpLimit = 1000;
const idKey = /^[A-Za-z0-9_-]{8,64}$/;
const bytes32 = /^0x[0-9a-fA-F]{64}$/;
const shortCode = /^[0123456789abcdefghjkmnpqrstvwxyz]{12}$/i;
const versionPattern = /^(0|[1-9][0-9]{0,19})$/;
const unsafeText = /[\x00-\x1f\x7f-\x9f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export interface ErpOperation {
  action: "create" | "receive" | "remove";
  idempotencyKey: string;
  productCode?: string;
  data: Record<string, unknown>;
}
export interface ErpBatch {
  idempotencyKey: string;
  reference: string | null;
  occurredAt: string | null;
  operations: ErpOperation[];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unexpected field.");
}
export function erpText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > max || unsafeText.test(value))
    throw new Error("Invalid text.");
  return value.trim();
}
function key(value: unknown): string {
  if (typeof value !== "string" || !idKey.test(value)) throw new Error("Invalid idempotency key.");
  return value;
}
export function erpProductCode(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid product code.");
  let code = value.trim();
  if (code.startsWith("https://") || code.startsWith("http://")) {
    const url = new URL(code);
    if (url.username || url.password || url.search || url.hash) throw new Error("Use a plain tracking link.");
    const match = /^\/(?:s|track)\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) throw new Error("Invalid tracking link.");
    code = match[1];
  }
  if (!bytes32.test(code) && !shortCode.test(code)) throw new Error("Use a TraceForge code.");
  return code.toLowerCase();
}
export function parseErpScopes(value: unknown): ErpScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > erpScopes.length ||
      value.some(scope => !erpScopes.includes(scope)) || new Set(value).size !== value.length)
    throw new Error("Invalid access scopes.");
  return [...value].sort() as ErpScope[];
}
export function parseErpBatch(value: unknown): ErpBatch {
  const body = object(value);
  fields(body, ["idempotencyKey", "reference", "occurredAt", "operations"]);
  const batchKey = key(body.idempotencyKey);
  const reference = body.reference === undefined ? null : erpText(body.reference, 120);
  let occurredAt: string | null = null;
  if (body.occurredAt !== undefined) {
    if (typeof body.occurredAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(body.occurredAt))
      throw new Error("Use an ISO UTC timestamp.");
    const canonical = new Date(body.occurredAt).toISOString();
    const expected = body.occurredAt.includes(".") ? body.occurredAt : body.occurredAt.slice(0, -1) + ".000Z";
    if (canonical !== expected || Number(canonical.slice(0, 4)) < 1000)
      throw new Error("Invalid timestamp.");
    occurredAt = canonical;
  }
  if (!Array.isArray(body.operations) || body.operations.length < 1 || body.operations.length > maxErpOperations)
    throw new Error("Send 1 to 100 operations.");
  const seen = new Set<string>();
  const operations = body.operations.map((value): ErpOperation => {
    const item = object(value);
    fields(item, ["action", "idempotencyKey", "productCode", "data"]);
    const itemKey = key(item.idempotencyKey);
    if (seen.has(itemKey)) throw new Error("Each operation needs a different key.");
    seen.add(itemKey);
    const data = object(item.data);
    if (item.action === "create") {
      fields(data, ["name", "id", "quantity", "fields", "publish"]);
      if (item.productCode !== undefined || typeof data.name !== "string" || typeof data.id !== "string" || typeof data.publish !== "boolean")
        throw new Error("Invalid registration.");
      const registration = productRegistration({name: data.name, id: data.id, quantity: data.quantity as number | undefined, fields: data.fields});
      return {action: "create", idempotencyKey: itemKey, data: {name: registration.name, id: registration.id,
        quantity: registration.quantity, fields: registration.fields as ProductField[], publish: data.publish}};
    }
    if (item.action !== "receive" && item.action !== "remove") throw new Error("Invalid action.");
    fields(data, item.action === "receive" ? ["sourceRouteId", "quantity", "version", "confirmed"] :
      ["routeId", "quantity", "version", "reason", "reasonText", "confirmed"]);
    if (data.confirmed !== true) throw new Error("Confirm physical receipt or completed removal.");
    const normalized: Record<string, unknown> = {confirmed: true, quantity: productQuantity(data.quantity)};
    if (data.version !== undefined) {
      if (typeof data.version !== "string" || !versionPattern.test(data.version) || BigInt(data.version) > 18446744073709551615n)
        throw new Error("Invalid version.");
      normalized.version = data.version;
    }
    const route = item.action === "receive" ? "sourceRouteId" : "routeId";
    if (data[route] !== undefined) {
      if (typeof data[route] !== "string" || !bytes32.test(data[route])) throw new Error("Invalid route.");
      normalized[route] = (data[route] as string).toLowerCase();
    }
    if (item.action === "remove") Object.assign(normalized, removalInput(data));
    return {action: item.action, idempotencyKey: itemKey, productCode: erpProductCode(item.productCode), data: normalized};
  });
  return {idempotencyKey: batchKey, reference, occurredAt, operations};
}
