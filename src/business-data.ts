import type {RowDataPacket} from "mysql2/promise";
import {keccak256,stringToHex} from "viem";
import {db} from "./db.js";
import {config} from "./config.js";
import {BusinessProblem} from "./business-write.js";
import {normalizeShortCode} from "./public-short-links.js";
const hash=(s:string)=>keccak256(stringToHex(s));

export async function document(kind: string, value: unknown) {
  const raw = JSON.stringify(value), contentHash = hash(raw);
  await db.query(`INSERT IGNORE INTO offchain_documents
    (content_hash,document_kind,source_ref,byte_length,document_json,raw_text) VALUES (?,?,?,?,?,?)`,
    [contentHash,kind,"business-dashboard",Buffer.byteLength(raw),raw,raw]);
  return contentHash;
}


export async function productReference(tracking: string) {
  let trackingId = tracking.toLowerCase();
  if (normalizeShortCode(trackingId)) {
    const [aliases] = await db.query<RowDataPacket[]>(`SELECT CONCAT('0x',LOWER(HEX(tracking_id))) AS tracking_id
      FROM public_entity_short_links WHERE short_code=?`, [trackingId]);
    if (!aliases[0]) throw new BusinessProblem("product_not_found", 404);
    trackingId = aliases[0].tracking_id;
  }
  if (!/^0x[0-9a-f]{64}$/.test(trackingId)) throw new BusinessProblem("invalid_request", 400);
  const [rows] = await db.query<RowDataPacket[]>(`SELECT tracking_id,tenant_id,entity_id,creator_organization_id,public_details,publication_initialized,
    initial_quantity,external_id,registration_metadata_hash FROM business_product_records WHERE tracking_id=?
    AND (confirmed=TRUE OR initial_quantity IS NULL) AND (chain_id IS NULL OR (chain_id=? AND contract_address=?))`,
    [trackingId,config.traceforge.chainId,config.traceforge.contractAddress.toLowerCase()]);
  if (!rows[0]) throw new BusinessProblem("product_not_found", 404);
  return rows[0];
}
