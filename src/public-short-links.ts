import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const codePattern = /^[0123456789abcdefghjkmnpqrstvwxyz]{12}$/;
const bytes32 = /^0x[0-9a-fA-F]{64}$/;
export const shortCodeParamPattern = "^[0123456789abcdefghjkmnpqrstvwxyzABCDEFGHJKMNPQRSTVWXYZ]{12}$";

export function normalizeShortCode(value: string): string | null {
  const code = value.toLowerCase();
  return codePattern.test(code) ? code : null;
}

export function newPublicShortCode(): string {
  // 32 symbols and 12 independent uniform selections give 60 random bits.
  // Masking a random byte has no modulo bias because 32 divides 256.
  return Array.from(randomBytes(12), byte => alphabet[byte & 31]).join("");
}

interface ShortRow extends RowDataPacket { short_code: string }

// Never recycle an issued code. Eligibility is checked for both reuse and
// insertion; unpublished/orphaned records keep their reserved alias hidden.
export async function issuePublicShortLink(
  db: Pick<Pool, "query">,
  value: string,
  generate: () => string = newPublicShortCode,
): Promise<string> {
  if (!bytes32.test(value)) throw new Error("Tracking ID must be a bytes32 value.");
  const trackingId = value.toLowerCase();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const [existing] = await db.query<ShortRow[]>(
      `SELECT s.short_code FROM public_entity_short_links s
       JOIN public_entity_tracking_ids t ON t.tracking_id = s.tracking_id
       JOIN public_entity_publications p ON p.tenant_id = t.tenant_id AND p.entity_id = t.entity_id
       JOIN entities e ON e.tenant_id = p.tenant_id AND e.entity_id = p.entity_id
       WHERE s.tracking_id = UNHEX(SUBSTRING(?, 3)) LIMIT 1`, [trackingId]);
    if (existing[0]) return existing[0].short_code;
    const code = generate();
    if (normalizeShortCode(code) !== code) throw new Error("Short code generator returned an invalid code.");
    try {
      const [result] = await db.query<ResultSetHeader>(
        `INSERT INTO public_entity_short_links (short_code, tracking_id)
         SELECT ?, t.tracking_id FROM public_entity_tracking_ids t
         JOIN public_entity_publications p ON p.tenant_id = t.tenant_id AND p.entity_id = t.entity_id
         JOIN entities e ON e.tenant_id = p.tenant_id AND e.entity_id = p.entity_id
         WHERE t.tracking_id = UNHEX(SUBSTRING(?, 3))`, [code, trackingId]);
      if (result.affectedRows !== 1) throw new Error("Tracking ID must resolve to an existing published product before shortening.");
      return code;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY")) throw error;
      // Either another issuer reserved this tracking ID, or another product
      // owns the random code. Recheck and retry without changing any binding.
    }
  }
  throw new Error("Could not reserve a unique short code; retry later.");
}

// Business registration aliases are issued after a verified receipt, including
// private products. Public resolution still joins the publication gate.
export async function issueProductShortLink(db:Pick<Pool,"query">,value:string,generate= newPublicShortCode):Promise<string>{
 if(!bytes32.test(value))throw new Error("Invalid tracking ID.");
 const trackingId=value.toLowerCase();
 for(let attempt=0;attempt<8;attempt++){
  const [existing]=await db.query<ShortRow[]>(`SELECT s.short_code FROM public_entity_short_links s
   JOIN business_product_records r ON r.tracking_id=CONCAT('0x',LOWER(HEX(s.tracking_id)))
   WHERE r.tracking_id=? AND r.confirmed=TRUE`,[trackingId]);
  if(existing[0])return existing[0].short_code;
  const code=generate();if(normalizeShortCode(code)!==code)throw new Error("Invalid short code generator.");
  try{
   const [result]=await db.query<ResultSetHeader>(`INSERT INTO public_entity_short_links(short_code,tracking_id)
    SELECT ?,UNHEX(SUBSTRING(tracking_id,3)) FROM business_product_records WHERE tracking_id=? AND confirmed=TRUE`,[code,trackingId]);
   if(result.affectedRows!==1)throw new Error("Product must be confirmed before shortening.");
   return code;
  }catch(error){if((error as {code?:string}).code!=="ER_DUP_ENTRY")throw error;}
 }
 throw new Error("Short code allocation is busy; retry.");
}
