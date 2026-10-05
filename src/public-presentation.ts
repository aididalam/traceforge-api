import type { Pool, RowDataPacket } from "mysql2/promise";

type Reader = Pick<Pool, "query">;
export interface ProductInfo {
  name: string | null;
  description: string | null;
  fields: { label: string; value: string }[];
}
export interface OrganizationProfile {
  id: string;
  metadataHash: string;
  name: string;
  type: string | null;
}
export interface PresentationInput {
  metadataHash: string;
  productInfo: ProductInfo;
  organizations: OrganizationProfile[];
}
export interface Presentation {
  productInfo: ProductInfo | null;
  organizations: Map<string, OrganizationProfile>;
}
const bytes32 = /^0x[0-9a-fA-F]{64}$/;
const zeroId = "0x" + "0".repeat(64);

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) throw new Error("Invalid public details format.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new Error("Invalid public details text.");
  }
  return value.trim();
}
function id(value: unknown): string {
  if (typeof value !== "string" || !bytes32.test(value) || value.toLowerCase() === zeroId) {
    throw new Error("Invalid public details reference.");
  }
  return value.toLowerCase();
}
export function validatePresentation(value: unknown): PresentationInput {
  const input = object(value, ["metadataHash", "productInfo", "organizations"]);
  const product = object(input.productInfo, ["name", "description", "fields"]);
  if (!Array.isArray(product.fields) || product.fields.length > 32 ||
      !Array.isArray(input.organizations) || input.organizations.length > 32) throw new Error("Too many public details.");
  const fields = product.fields.map(value => {
    const field = object(value, ["label", "value"]);
    return { label: text(field.label, 80)!, value: text(field.value, 1000)! };
  });
  if (new Set(fields.map(field => field.label.toLowerCase())).size !== fields.length) throw new Error("Duplicate public detail labels.");
  const organizations = input.organizations.map(value => {
    const org = object(value, ["id", "metadataHash", "name", "type"]);
    return { id: id(org.id), metadataHash: id(org.metadataHash), name: text(org.name, 255)!, type: text(org.type, 255, true) };
  });
  if (new Set(organizations.map(org => org.id)).size !== organizations.length) throw new Error("Duplicate public businesses.");
  return { metadataHash: id(input.metadataHash),
    productInfo: { name: text(product.name, 255, true), description: text(product.description, 2000, true), fields }, organizations };
}

// Caller owns the transaction. This operation shares only a reviewed snapshot;
// it neither publishes a product nor reads its original metadata document.
export async function savePublicPresentation(db: Reader, tenantId: string, entityId: string, value: unknown | null) {
  const tenant = id(tenantId), entity = id(entityId);
  if (value === null) {
    await db.query("DELETE FROM public_entity_presentations WHERE tenant_id=? AND entity_id=?", [tenant, entity]);
    return;
  }
  const profile = validatePresentation(value);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT e.metadata_hash FROM public_entity_publications p
     JOIN entities e ON e.tenant_id=p.tenant_id AND e.entity_id=p.entity_id
     WHERE p.tenant_id=? AND p.entity_id=? FOR UPDATE`, [tenant, entity]);
  if (rows.length !== 1) throw new Error("Publish the indexed product before sharing its details.");
  if (rows[0].metadata_hash.toLowerCase() !== profile.metadataHash) throw new Error("Product information reference has changed; review the details again.");
  for (const org of profile.organizations) {
    const [organizations] = await db.query<RowDataPacket[]>(
      `SELECT o.metadata_hash FROM organizations o WHERE o.organization_id=? FOR UPDATE`, [org.id]);
    if (organizations.length !== 1 || organizations[0].metadata_hash.toLowerCase() !== org.metadataHash) {
      throw new Error("Business reference does not match this workspace's indexed records.");
    }
  }
  await db.query(
    `INSERT INTO public_entity_presentations (tenant_id,entity_id,metadata_hash,product_info,organization_profiles)
     VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE metadata_hash=VALUES(metadata_hash), product_info=VALUES(product_info), organization_profiles=VALUES(organization_profiles)`,
    [tenant, entity, profile.metadataHash, JSON.stringify(profile.productInfo), JSON.stringify(profile.organizations)]);
}

interface ProfileRow extends RowDataPacket {
  metadata_hash: string;
  product_info: ProductInfo | string;
  organization_profiles: OrganizationProfile[] | string;
}
interface OrganizationRow extends RowDataPacket { organization_id: string; metadata_hash: string }
const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;

// This table contains separately approved display data. Public reads never
// resolve private off-chain documents, files, actor wallets or evidence bodies.
export async function readPublicPresentation(db: Reader, tenantId: string, entityId: string, metadataHash: string): Promise<Presentation> {
  const empty: Presentation = { productInfo: null, organizations: new Map() };
  let rows: ProfileRow[];
  try {
    [rows] = await db.query<ProfileRow[]>(
      `SELECT pp.metadata_hash, pp.product_info, pp.organization_profiles FROM public_entity_presentations pp
       JOIN public_entity_publications p ON p.tenant_id=pp.tenant_id AND p.entity_id=pp.entity_id
       WHERE pp.tenant_id = ? AND pp.entity_id = ? LIMIT 1`, [tenantId, entityId]);
  } catch (error) {
    // Existing installations can still show dated history before migration 006.
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return empty;
    throw error;
  }
  if (!rows.length) return empty;
  let profile: PresentationInput;
  try {
    profile = validatePresentation({ metadataHash: rows[0].metadata_hash, productInfo: json(rows[0].product_info), organizations: json(rows[0].organization_profiles) });
  } catch { return empty; }
  const productInfo = profile.metadataHash === metadataHash.toLowerCase() ? profile.productInfo : null;
  if (!profile.organizations.length) return { ...empty, productInfo };
  const [organizations] = await db.query<OrganizationRow[]>(
    `SELECT o.organization_id, o.metadata_hash FROM organizations o
     WHERE o.organization_id IN (${profile.organizations.map(() => "?").join(",")})`,
    profile.organizations.map(org => org.id));
  const currentHashes = new Map(organizations.map(org => [org.organization_id.toLowerCase(), org.metadata_hash.toLowerCase()]));
  return { productInfo, organizations: new Map(profile.organizations
    .filter(org => currentHashes.get(org.id) === org.metadataHash).map(org => [org.id, org])) };
}

export function publicOrganization(value: unknown, presentation: Presentation) {
  if (typeof value !== "string" || !bytes32.test(value) || value.toLowerCase() === zeroId) return null;
  const normalized = value.toLowerCase();
  const profile = presentation.organizations.get(normalized);
  return { id: normalized, name: profile?.name ?? null, type: profile?.type ?? null };
}

export function publicTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) return null;
  return value;
}
