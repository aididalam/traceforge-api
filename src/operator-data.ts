import type { Pool, RowDataPacket } from "mysql2/promise";
import { publicTimestamp } from "./public-presentation.js";
import { readProductFields } from "./product-metadata.js";
import { businessHistoryPredicate } from "./product-history.js";
import { quantitySummary } from "./product-quantity.js";
import { removalReasons } from "./product-input.js";
export type OperatorReader = Pick<Pool, "query">;
export interface OperatorPrincipal { accountId: string; email: string; name: string; tenantId: string; organizationId: string; workspaceName: string | null; organizationName: string | null; businessCode?:string|null; access: "manage" }
export const text = (value: unknown, limit = 240): string | null => typeof value === "string" && value !== "null" && value.trim() ? value.trim().slice(0, limit) : null;
export const organization = (row: RowDataPacket) => ({ id: row.organization_id, name: text(row.name), type: text(row.type, 120), active: Boolean(row.active) });
export async function businesses(db: OperatorReader, tenantId: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT o.organization_id,o.active,
    JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.name')) AS name,
    JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.organizationType')) AS type
    FROM organizations o LEFT JOIN offchain_documents d ON d.content_hash=o.metadata_hash AND d.document_kind='organization'
    ORDER BY o.organization_id LIMIT 201`);
  return { businesses: rows.slice(0,200).map(organization), truncated: rows.length>200 };
}
export async function products(db: OperatorReader, principal: OperatorPrincipal, scope: [number,string], after: string, limit: number, entityId?: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT r.tracking_id AS entity_id, e.tenant_id, CAST(e.created_event_id AS CHAR) AS created_cursor,
    e.closed, CAST(e.created_at AS CHAR) AS created_at, e.current_custodian,r.initial_quantity,
    et.display_label AS type_label, st.display_label AS status_label,
    JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.name')) AS name,
    JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.description')) AS description,
    JSON_EXTRACT(d.document_json,'$.fields') AS custom_fields,
    JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.units')) AS units,
    JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.packagingStatus')) AS packaging,
    JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.qualityStatus')) AS quality,
    JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.revision')) AS revision,
    JSON_UNQUOTE(JSON_EXTRACT(od.document_json,'$.name')) AS holder_name
    FROM entities e JOIN business_product_records r ON r.tenant_id=e.tenant_id AND r.entity_id=e.entity_id
    LEFT JOIN semantic_registry et ON et.chain_id=? AND et.contract_address=? AND et.semantic_kind='entity_type' AND et.semantic_hash=e.entity_type
    LEFT JOIN semantic_registry st ON st.chain_id=? AND st.contract_address=? AND st.semantic_kind='state' AND st.semantic_hash=e.current_state
    LEFT JOIN offchain_documents d ON d.content_hash=e.metadata_hash AND d.document_kind='entity'
    LEFT JOIN organizations o ON o.organization_id=e.current_custodian
    LEFT JOIN offchain_documents od ON od.content_hash=o.metadata_hash AND od.document_kind='organization'
    WHERE (e.current_custodian=? OR r.creator_organization_id=? OR EXISTS
      (SELECT 1 FROM custody_claims c WHERE c.tenant_id=e.tenant_id AND c.entity_id=e.entity_id AND
        (c.from_organization_id=? OR c.to_organization_id=?)) OR EXISTS
      (SELECT 1 FROM batch_routes br WHERE br.chain_id=? AND br.contract_address=? AND br.tenant_id=e.tenant_id AND br.entity_id=e.entity_id AND br.organization_id=?))
      AND (r.chain_id IS NULL OR (r.chain_id=? AND r.contract_address=?)) AND ${entityId ? "r.tracking_id=?" : "e.created_event_id>?"}
    ORDER BY e.created_event_id LIMIT ?`, [...scope,...scope,principal.organizationId,principal.organizationId,principal.organizationId,principal.organizationId,
      ...scope,principal.organizationId,...scope,entityId??after,limit+1]);
  const visible=rows.slice(0,limit);
  return { products: await Promise.all(visible.map(async row=>({ id: row.entity_id, name: text(row.name), description: text(row.description,2000),
    type: text(row.type_label), status: text(row.status_label), closed: Boolean(row.closed), createdAt: String(row.created_at),
    holder: row.initial_quantity!=null&&BigInt(row.initial_quantity)>1n?null:{ id: row.current_custodian, name: text(row.holder_name) },
    ...(row.initial_quantity!=null?{quantity:await quantitySummary(db,scope,row.tenant_id,row.entity_id,principal.organizationId)}:{}),
    fields: readProductFields(row.custom_fields,[["Units",row.units],["Packaging",row.packaging],["Quality",row.quality],["Revision",row.revision]]
      .filter(([,value])=>text(value)!==null).map(([label,value])=>({ label, value: text(value,1000)! }))) }))),
    page: { hasMore: rows.length>limit, next: rows.length>limit ? String(visible.at(-1)!.created_cursor) : null } };
}
export async function productHistory(db: OperatorReader, principal: OperatorPrincipal, scope: [number,string], entityId: string, after: string, limit: number) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT CAST(ce.id AS CHAR) AS id, ce.event_name,
    ev.display_label AS label, JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.organizationId')) AS organization_id,
    JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.fromOrganizationId')) AS from_id,
    JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.toOrganizationId')) AS to_id,
    ce.transaction_hash,JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.quantity')) AS quantity,
    JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.initialQuantity')) AS initial_quantity,
    JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.reason')) AS removal_reason,
    JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.reasonText')) AS reason_text,
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.sourceRouteId')),JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.routeId'))) AS route_id,
    JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.receivedRouteId')) AS received_route_id,
    CASE ce.event_name
      WHEN 'EntityCreated' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.createdAt'))
      WHEN 'ProductRegistered' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.timestamp'))
      WHEN 'BatchReceived' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.timestamp'))
      WHEN 'ReceiptApproved' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.timestamp'))
      WHEN 'QuantityRemoved' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.timestamp'))
      WHEN 'TraceRecorded' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.timestamp'))
      WHEN 'CustodyClaimed' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.timestamp'))
      WHEN 'EntityLinkCreated' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.createdAt'))
      WHEN 'EntityLinkStatusChanged' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.updatedAt'))
      WHEN 'EntityClosed' THEN JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.closedAt')) END AS occurred_at
    FROM chain_events ce
    LEFT JOIN semantic_registry ev ON ev.chain_id=ce.chain_id AND ev.contract_address=ce.contract_address
      AND ev.semantic_kind='event_type' AND ev.semantic_hash=JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.eventType'))
    JOIN business_product_records r ON r.tenant_id=JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.tenantId'))
    WHERE ce.chain_id=? AND ce.contract_address=? AND ce.id>?
      AND r.tracking_id=? AND (JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.entityId'))=r.entity_id
        OR JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.sourceEntityId'))=r.entity_id
        OR JSON_UNQUOTE(JSON_EXTRACT(ce.event_args,'$.targetEntityId'))=r.entity_id)
      AND ${businessHistoryPredicate}
    ORDER BY ce.id LIMIT ?`, [...scope,after,entityId,limit+1]);
  const visible=rows.slice(0,limit);
  return { events: visible.map(row=>({ id: String(row.id), name: row.event_name,
    label: text(row.label)??({ProductRegistered:"Added to supply chain",BatchReceived:"Product received",QuantityRemoved:"Removed from supply chain"}[row.event_name as "ProductRegistered"]??null),
    occurredAt: publicTimestamp(row.occurred_at), organizationId: ['CustodyClaimed','BatchReceived'].includes(row.event_name)?row.to_id:row.organization_id??row.from_id??null,
    fromId: row.from_id??null, toId: row.to_id??null, transactionHash: row.transaction_hash,
    ...(["ProductRegistered","BatchReceived","QuantityRemoved"].includes(row.event_name)?{quantity:{quantity:String(row.quantity??row.initial_quantity),
      reason:row.removal_reason==null?null:removalReasons[Number(row.removal_reason)],reasonText:row.reason_text??null,
      routeId:row.route_id??null,receivedRouteId:row.received_route_id??null}}:{}) })),
    page: { hasMore: rows.length>limit, next: rows.length>limit?String(visible.at(-1)!.id):null } };
}
export async function operations(db: OperatorReader, principal: OperatorPrincipal) {
  // Never select signed transactions, request payloads, idempotency keys or errors.
  const [rows] = await db.query<RowDataPacket[]>(`SELECT operation_id, entity_id, operation_name, status,
    transaction_hash, CAST(block_number AS CHAR) AS block_number, created_at, updated_at
    FROM chain_write_operations WHERE organization_id=?
    ORDER BY created_at DESC, operation_id DESC LIMIT 51`, [principal.organizationId]);
  const iso=(value:unknown)=>value instanceof Date?value.toISOString():String(value);
  return { operations: rows.slice(0,50).map(row=>({ id:row.operation_id, productId:row.entity_id, name:row.operation_name,
    status:row.status, transactionHash:row.transaction_hash, blockNumber:row.block_number??null,
    createdAt:iso(row.created_at), updatedAt:iso(row.updated_at) })), truncated:rows.length>50 };
}
