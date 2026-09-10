export type SetupEntity = "products" | "customers";
export const setupFields = {
  products: {
    reorder_level: "Reorder level", minimum_stock_level: "Minimum stock", track_batch: "Track batches", track_expiry: "Track expiry",
    unit_type: "Main unit", units_per_pack: "Units per pack", brand_id: "Brand", category_id: "Category", overselling_policy: "Overselling policy",
  },
  customers: {
    city: "City", area: "Area", credit_policy: "Credit policy", credit_limit: "Credit limit", credit_days: "Credit days",
    assigned_salesman_id: "Assigned salesman", assigned_territory_id: "Assigned territory", preferred_payment_method: "Preferred payment method",
  },
} as const;
export function missingSetup(entity: SetupEntity, row: Record<string, unknown>) {
  return Object.entries(setupFields[entity]).filter(([key]) => row[key] === null || row[key] === undefined || row[key] === "").map(([key, label]) => ({ key, label }));
}
export function validateSetupValue(entity: SetupEntity, field: string, raw: unknown): unknown {
  if (!Object.hasOwn(setupFields[entity], field)) throw new Error("Unsupported setting");
  if (["reorder_level", "minimum_stock_level", "units_per_pack", "credit_limit", "credit_days"].includes(field)) {
    if ((typeof raw !== "number" && typeof raw !== "string") || (typeof raw === "string" && !raw.trim())) throw new Error("Enter a number");
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1000000000 || (field === "units_per_pack" && value < 1) || (["units_per_pack", "credit_days"].includes(field) && !Number.isInteger(value))) throw new Error("Enter a valid non-negative value; pack size must be a positive integer");
    return value;
  }
  if (["track_batch", "track_expiry"].includes(field)) {
    if (![true, false, "true", "false"].includes(raw as boolean)) throw new Error("Choose Yes or No");
    return raw === true || raw === "true";
  }
  const value = typeof raw === "string" ? raw.trim() : "";
  const choices: Record<string, string[]> = { credit_policy: ["cash_only", "limit_only", "days_only", "limit_and_days", "unrestricted"], overselling_policy: ["allow", "block"], preferred_payment_method: ["cash", "bank", "other"] };
  if (!value || value.length > 150 || (choices[field] && !choices[field].includes(value))) throw new Error("Choose a valid setting value");
  return value;
}
