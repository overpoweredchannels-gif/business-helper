import type { EntityImportConfig } from "../types";

export const suppliersImportConfig: EntityImportConfig = {
  entityKey: "suppliers", entityName: "Suppliers", tableName: "suppliers",
  existingColumns: "id, supplier_name, contact_person, phone, whatsapp, city, area, notes, is_active",
  fields: [
    { key: "supplier_name", label: "Supplier Name", type: "text", required: true, unique: true },
    ...["contact_person", "phone", "whatsapp", "city", "area", "notes"].map(key => ({ key, label: key.replace(/_/g, " "), type: "text" as const })),
    { key: "is_active", label: "Active", type: "boolean", defaultValue: true },
  ],
  uniqueKeys: [["supplier_name"]], defaultDuplicateMode: "skip", maxRows: 5000,
  async buildUpsertPayload(row) {
    const values = row.values;
    return Object.fromEntries(Object.entries(values).filter(([key]) => ["supplier_name", "contact_person", "phone", "whatsapp", "city", "area", "notes", "is_active"].includes(key)).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
  },
  async findExisting(row, ctx) {
    const { data, error } = await ctx.supabase.from("suppliers").select("id").eq("organization_id", ctx.orgId).eq("supplier_name", String(row.values.supplier_name).trim()).limit(2);
    if (error) throw error;
    if ((data?.length ?? 0) > 1) throw new Error("Multiple suppliers have this name. Resolve the duplicate before importing.");
    return data?.[0] ?? null;
  },
  async applyUpdate(existing, payload, ctx) {
    const id = (existing as { id: string }).id;
    const { data, error } = await ctx.supabase.from("suppliers").update(payload).eq("id", id).eq("organization_id", ctx.orgId).select("*").single();
    if (error) throw error;
    return data;
  },
};
