export interface ProductField { label: string; value: string }

const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

// An ordered JSON array preserves operator labels without treating them as
// object properties or reserving business-specific field names.
export function normalizeProductFields(value: unknown): ProductField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error("Invalid product fields.");
  const labels = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some(key => !["label", "value"].includes(key))) throw new Error("Invalid product field.");
    if (typeof item.label !== "string" || typeof item.value !== "string") throw new Error("Invalid product field.");
    const label = item.label.trim(), fieldValue = item.value.trim(), key = label.toLowerCase();
    if (!label || label.length > 80 || !fieldValue || fieldValue.length > 1000 ||
        controls.test(label) || controls.test(fieldValue) || labels.has(key)) throw new Error("Invalid product field.");
    labels.add(key);
    return { label, value: fieldValue };
  });
}

export function readProductFields(value: unknown, legacy: ProductField[] = []): ProductField[] {
  let fields: ProductField[];
  try { fields = normalizeProductFields(typeof value === "string" ? JSON.parse(value) : value ?? undefined); }
  catch { fields = []; }
  const labels = new Set(fields.map(field => field.label.toLowerCase()));
  return [...fields, ...legacy.filter(field => !labels.has(field.label.toLowerCase()))].slice(0, 32);
}
