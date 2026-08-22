// TradeOS ERP — Products Import Config
//
// Extends the existing product import logic with the universal architecture.

import type { EntityImportConfig, ImportFieldDef, ParsedRow, ImportContext } from "../types";

function parseNumber(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBool(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "true", "1", "y", "on"].includes(normalized)) return true;
  if (["no", "false", "0", "n", "off", "none"].includes(normalized)) return false;
  return null;
}

function parsePolicy(raw: string): "allow" | "block" | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "allow" || normalized === "allowed") return "allow";
  if (normalized === "block" || normalized === "blocked") return "block";
  return null;
}

function parsePrice(raw: string): number | null {
  // Handle PKR format with commas
  return parseNumber(raw);
}

function parseUnitsPerPack(raw: string): number | null {
  return parseNumber(raw);
}

export const productsImportConfig: EntityImportConfig = {
  entityKey: "products",
  entityName: "Products",
  tableName: "products",
  existingColumns: "id, name, sku, barcode, brand_id, category_id, unit_type, subunit_type, units_per_pack, default_purchase_price, default_selling_price, minimum_stock_level, reorder_level, track_batch, track_expiry, overselling_policy, is_active",
  
  fields: [
    { key: "name", label: "Product Name", type: "text", required: true, unique: true, preview: true, width: 180, help: "Required. Unique within brand." },
    { key: "sku", label: "SKU", type: "text", unique: true, preview: true, width: 120, help: "Optional unique stock code." },
    { key: "barcode", label: "Barcode", type: "text", unique: true, preview: true, width: 140, help: "Optional barcode/GTIN." },
    { 
      key: "brand", 
      label: "Brand", 
      type: "select", 
      required: false, 
      preview: true, 
      width: 140,
      options: async (orgId) => {
        // Will be resolved at runtime via refCaches
        return [];
      },
      help: "Select existing brand or type new name to auto-create."
    },
    { 
      key: "category", 
      label: "Category", 
      type: "select", 
      required: false, 
      preview: true, 
      width: 140,
      options: async (orgId) => [],
      help: "Select existing category."
    },
    { key: "unit_type", label: "Unit Type", type: "text", required: false, preview: true, width: 100, help: "Main unit label (e.g. Cotton, Box, Piece)." },
    { key: "subunit_type", label: "Subunit Type", type: "text", required: false, preview: true, width: 100, help: "Sub-unit label (e.g. Box, Pack)." },
    { key: "units_per_pack", label: "Units/Pack", type: "integer", required: false, preview: true, width: 90, parse: parseUnitsPerPack, help: "Pieces per main unit (e.g. 20 for 20 pieces per box)." },
    { key: "default_purchase_price", label: "Purchase Price", type: "decimal", required: false, preview: true, width: 110, parse: parsePrice, help: "Default cost price per main unit." },
    { key: "default_selling_price", label: "Selling Price", type: "decimal", required: false, preview: true, width: 110, parse: parsePrice, help: "Default sale price per main unit." },
    { key: "minimum_stock_level", label: "Min Stock", type: "decimal", required: false, preview: true, width: 90, parse: parseNumber, help: "Reorder threshold." },
    { key: "reorder_level", label: "Reorder Level", type: "decimal", required: false, preview: true, width: 90, parse: parseNumber, help: "Quantity to reorder." },
    { key: "track_batch", label: "Track Batch", type: "boolean", required: false, preview: true, width: 90, parse: parseBool, help: "Enable batch tracking." },
    { key: "track_expiry", label: "Track Expiry", type: "boolean", required: false, preview: true, width: 90, parse: parseBool, help: "Enable expiry tracking." },
    { key: "overselling_policy", label: "Oversell Policy", type: "select", required: false, preview: true, width: 110, parse: parsePolicy, options: ["allow", "block"], help: "Allow or block overselling." },
    { key: "initial_stock", label: "Initial Stock", type: "decimal", required: false, preview: true, width: 100, parse: parseNumber, help: "Opening stock quantity (creates ledger entry)." },
    { key: "is_active", label: "Active", type: "boolean", required: false, preview: false, parse: parseBool, defaultValue: true },
  ],

  uniqueKeys: [
    ["sku"],
    ["barcode"],
    ["name", "brand"],
  ],

  defaultDuplicateMode: "skip",
  allowCreateReferences: true,
  maxRows: 5000,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const brandId = v.brand ? await resolveRef(ctx, "brands", v.brand as string) : null;
    const categoryId = v.category ? await resolveRef(ctx, "categories", v.category as string) : null;

    return {
      name: String(v.name ?? "").trim(),
      sku: v.sku ? String(v.sku).trim() : null,
      barcode: v.barcode ? String(v.barcode).trim() : null,
      brand_id: brandId,
      category_id: categoryId,
      unit_type: v.unit_type ? String(v.unit_type).trim() : null,
      subunit_type: v.subunit_type ? String(v.subunit_type).trim() : null,
      units_per_pack: v.units_per_pack as number | null,
      default_purchase_price: v.default_purchase_price as number | null,
      default_selling_price: v.default_selling_price as number | null,
      minimum_stock_level: v.minimum_stock_level as number | null,
      reorder_level: v.reorder_level as number | null,
      track_batch: v.track_batch as boolean | null,
      track_expiry: v.track_expiry as boolean | null,
      overselling_policy: v.overselling_policy as "allow" | "block" | null,
      is_active: v.is_active as boolean ?? true,
      updated_at: new Date().toISOString(),
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const supabase = ctx.supabase;
    
    // Try SKU first
    if (v.sku) {
      const { data } = await supabase
        .from("products")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .eq("sku", String(v.sku).trim())
        .maybeSingle();
      if (data) return data as any;
    }
    
    // Try barcode
    if (v.barcode) {
      const { data } = await supabase
        .from("products")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .eq("barcode", String(v.barcode).trim())
        .maybeSingle();
      if (data) return data as any;
    }
    
    // Try name + brand
    if (v.name && v.brand) {
      const brandId = await resolveRef(ctx, "brands", v.brand as string);
      if (brandId) {
        const { data } = await supabase
          .from("products")
          .select("id")
          .eq("organization_id", ctx.orgId)
          .eq("name", String(v.name).trim())
          .eq("brand_id", brandId)
          .maybeSingle();
        if (data) return data as any;
      }
    }
    
    // Try name only (if unique within org)
    if (v.name) {
      const { data } = await supabase
        .from("products")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .eq("name", String(v.name).trim())
        .maybeSingle();
      if (data) return data as any;
    }
    
    return null;
  },

  async applyUpdate(existing, payload, ctx) {
    const supabase = ctx.supabase;
    const { error } = await supabase
      .from("products")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", (existing as any).id)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
    return { ...(existing as Record<string, unknown>), ...payload };
  },

  async postImportHook(created, updated, ctx) {
    if (!ctx.actorProfileId) return;
    
    const supabase = ctx.supabase;
    const initialStockMap = new Map<string | number, number>();
    
    // Collect initial stock from created products (rawValues holds the parsed
    // file row, including the initial_stock field).
    for (const row of created) {
      const rawValues = (row as any).rawValues ?? {};
      const initialStock = Number(rawValues.initial_stock ?? 0);
      if (initialStock > 0 && (row as any).id) {
        initialStockMap.set((row as any).id, initialStock);
      }
    }
    
    // Also check updated products for initial_stock in payload
    for (const row of updated) {
      const rawValues = (row as any).rawValues ?? {};
      const initialStock = Number(rawValues.initial_stock ?? 0);
      if (initialStock > 0 && (row as any).id) {
        initialStockMap.set((row as any).id, initialStock);
      }
    }
    
    // Apply initial stock adjustments directly (bypasses the adjust_inventory
    // RPC because it checks auth.uid(), which is null under the service key).
    for (const [productId, qty] of initialStockMap) {
      await supabase.from("inventory_transactions").insert({
        organization_id: ctx.orgId,
        product_id: String(productId),
        movement_type: "adjustment_in",
        quantity_delta: qty,
        reason: "Initial stock imported from product import file",
        reference_type: "adjustment",
        reference_id: null,
        created_by: ctx.actorProfileId,
      });
      const { data: prod } = await supabase
        .from("products")
        .select("current_stock")
        .eq("id", String(productId))
        .eq("organization_id", ctx.orgId)
        .maybeSingle();
      const current = Number((prod as any)?.current_stock ?? 0);
      await supabase
        .from("products")
        .update({ current_stock: current + qty, updated_at: new Date().toISOString() })
        .eq("id", String(productId))
        .eq("organization_id", ctx.orgId);
    }
  },

  export: {
    filenamePrefix: "products_export",
    columns: [
      { key: "name", label: "Product Name" },
      { key: "sku", label: "SKU" },
      { key: "barcode", label: "Barcode" },
      { key: "brand", label: "Brand", transform: (v) => (v as any)?.name ?? "" },
      { key: "category", label: "Category", transform: (v) => (v as any)?.name ?? "" },
      { key: "unit_type", label: "Unit Type" },
      { key: "subunit_type", label: "Subunit Type" },
      { key: "units_per_pack", label: "Units/Pack" },
      { key: "default_purchase_price", label: "Purchase Price" },
      { key: "default_selling_price", label: "Selling Price" },
      { key: "minimum_stock_level", label: "Min Stock" },
      { key: "reorder_level", label: "Reorder Level" },
      { key: "track_batch", label: "Track Batch", transform: (v) => v ? "Yes" : "No" },
      { key: "track_expiry", label: "Track Expiry", transform: (v) => v ? "Yes" : "No" },
      { key: "overselling_policy", label: "Oversell Policy" },
      { key: "current_stock", label: "Current Stock" },
      { key: "is_active", label: "Active", transform: (v) => v ? "Yes" : "No" },
    ],
    async fetchData(orgId, filters) {
      const supabase = (await import("@/lib/supabase/server")).createSupabaseService();
      let query = supabase
        .from("products")
        .select(`
          id, name, sku, barcode, unit_type, subunit_type, units_per_pack,
          default_purchase_price, default_selling_price, minimum_stock_level,
          reorder_level, track_batch, track_expiry, overselling_policy,
          current_stock, is_active,
          brand:brands(name),
          category:categories(name)
        `)
        .eq("organization_id", orgId);
      
      if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
      if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
      
      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  },
};

async function resolveRef(ctx: ImportContext, table: string, name: string): Promise<string | null> {
  if (!name?.trim()) return null;
  const key = name.trim().toLowerCase();
  
  let cache = ctx.refCaches.get(table);
  if (!cache) {
    cache = new Map();
    ctx.refCaches.set(table, cache);
    // Preload cache
    const { data } = await ctx.supabase
      .from(table)
      .select("id, name")
      .eq("organization_id", ctx.orgId);
    for (const row of data ?? []) {
      cache.set(String(row.name).trim().toLowerCase(), row.id);
    }
  }
  
  if (cache.has(key)) return cache.get(key)!;
  
  if (ctx.createMissingRefs) {
    const { data, error } = await ctx.supabase
      .from(table)
      .insert({ organization_id: ctx.orgId, name: name.trim() })
      .select("id")
      .single();
    if (!error && data) {
      cache.set(key, data.id);
      return data.id;
    }
  }
  
  return null;
}
