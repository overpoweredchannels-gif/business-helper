// TradeOS — Import Wizard: header normalization, column-mapping guesser, and
// row validation for product imports. Pure functions (no I/O) so they can be
// unit-tested without a database.

import type { Category, Brand, Product } from "@/lib/tradeos/types";
import { importedInitialStock } from "./initial-stock";
import type {
  ColumnMapping,
  DuplicateMode,
  ImportPreviewResult,
  ParsedImportRow,
  ProductImportField,
} from "./types";

export const IMPORT_FIELD_OPTIONS: { value: ProductImportField; label: string }[] = [
  { value: "name", label: "Product Name *" },
  { value: "sku", label: "SKU" },
  { value: "barcode", label: "Barcode" },
  { value: "brand", label: "Brand" },
  { value: "category", label: "Category" },
  { value: "unit_type", label: "Unit Type" },
  { value: "subunit_type", label: "Subunit Type (e.g. Pieces)" },
  { value: "units_per_pack", label: "Units Per Pack" },
  { value: "default_purchase_price", label: "Purchase Price" },
  { value: "default_selling_price", label: "Selling Price" },
  { value: "minimum_stock_level", label: "Minimum Stock Level" },
  { value: "reorder_level", label: "Reorder Level" },
  { value: "track_batch", label: "Track Batch" },
  { value: "track_expiry", label: "Track Expiry" },
  { value: "overselling_policy", label: "Overselling Policy" },
  { value: "initial_stock", label: "Initial Stock — Main Units (e.g. Cartons)" },
  { value: "initial_stock_subunit", label: "Initial Stock — Pieces / Subunits" },
  { value: "skip", label: "Do not import" },
];

const FIELD_ALIASES: Record<Exclude<ProductImportField, "skip">, string[]> = {
  initial_stock_subunit: ["initial stock pieces", "initial stock subunits", "opening stock pieces"],
  name: [
    "name",
    "product",
    "product name",
    "title",
    "item",
    "item name",
    "productname",
    "product_name",
  ],
  sku: [
    "sku",
    "code",
    "item code",
    "product code",
    "sku code",
    "product sku",
    "stock keeping unit",
    "serial",
    "serial number",
    "serial no",
    "serial no.",
    "sr no",
    "sr #",
  ],
  barcode: ["barcode", "bar code", "ean", "ean13", "upc", "barcode number"],
  brand: [
    "brand",
    "brand name",
    "manufacturer",
    "make",
    "company",
    "company name",
    "supplier brand",
    "brand/company",
    "store",
    "store name",
    "shop",
    "shop name",
    "outlet",
  ],
  category: ["category", "category name", "product category", "type"],
  unit_type: [
    "unit type",
    "unit",
    "uom",
    "unit of measure",
    "unitofmeasure",
    "sale unit",
    "packing",
    "packing type",
    "sell unit",
    "measurement unit",
  ],
  subunit_type: [
    "subunit type",
    "sub unit",
    "sub-unit",
    "piece unit",
    "piece type",
    "unit name pieces",
    "small unit",
    "secondary unit",
  ],
  units_per_pack: [
    "units per pack",
    "unitspack",
    "pack size",
    "pieces per pack",
    "pcs per pack",
    "pieces per box",
    "boxes per cotton",
    "boxes per pack",
    "per pack",
    "packing qty",
    "qty per pack",
  ],
  default_purchase_price: [
    "purchase price",
    "cost price",
    "buying price",
    "cost",
    "purchase price pkr",
    "purchaseprice",
    "purchase value",
    "purchasevalue",
    "cost value",
    "unit purchase cost",
  ],
  default_selling_price: [
    "selling price",
    "sale price",
    "retail price",
    "price",
    "selling price pkr",
    "sellingprice",
    "price per piece",
    "per piece price",
    "price/piece",
    "unit price",
    "price per unit",
    "sale value",
    "sales value",
    "retail",
    "rate",
  ],
  minimum_stock_level: ["minimum stock level", "min stock", "minimum stock", "min stock level"],
  reorder_level: ["reorder level", "reorder point", "reorder qty", "reorder quantity", "reorderlevel"],
  track_batch: ["track batch", "batch tracking", "trackbatch"],
  track_expiry: ["track expiry", "expiry tracking", "trackexpiry"],
  overselling_policy: ["overselling policy", "oversell policy", "overselling", "oversellingpolicy"],
  initial_stock: [
    "initial stock",
    "opening stock",
    "stock",
    "quantity",
    "qty",
    "current stock",
    "opening qty",
    "initialstock",
    "on hand",
    "qty on hand",
    "stock on hand",
    "units on hand",
    "onhand",
    "qoh",
    "qty in stock",
    "pcs",
    "pieces",
    "available qty",
    "available quantity",
    "in stock",
  ],
};

export function normalizeHeader(value: string): string {
  return String(value)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[*()]/g, "")
    .trim();
}

export function guessFieldForHeader(header: string): ProductImportField | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;

  // Pass 1: exact alias match (case/space/punct normalized on both sides).
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
    Exclude<ProductImportField, "skip">,
    string[],
  ][]) {
    if (aliases.includes(normalized)) return field;
  }

  // Pass 2: fuzzy substring match. Compress whitespace so "unit price" and
  // "Unit Price" both become "unitprice", then pick the LONGEST alias that is a
  // substring of the header. Longest-match-wins prevents the generic "unit"
  // alias from stealing "unit price", or "stock" from stealing "stock keeping unit".
  const compact = normalized.replace(/\s+/g, "");
  let best: { field: Exclude<ProductImportField, "skip">; length: number } | null = null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
    Exclude<ProductImportField, "skip">,
    string[],
  ][]) {
    for (const alias of aliases) {
      const aliasCompact = alias.replace(/\s+/g, "");
      if (aliasCompact.length < 3) continue;
      if (compact.includes(aliasCompact)) {
        if (!best || aliasCompact.length > best.length) {
          best = { field, length: aliasCompact.length };
        }
      }
    }
  }
  return best?.field ?? null;
}

export function guessColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    mapping[header] = guessFieldForHeader(header) ?? "skip";
  }
  return mapping;
}

/** A user's explicit selection replaces any earlier assignment of that destination. */
export function assignImportColumn(mapping: ColumnMapping, column: string, field: ProductImportField): ColumnMapping {
  const next = { ...mapping };
  if (field !== "skip") {
    for (const key of Object.keys(next)) {
      if (key !== column && next[key] === field) next[key] = "skip";
    }
  }
  next[column] = field;
  return next;
}

export function parseBoolValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "true", "1", "y", "on"].includes(normalized)) return true;
  if (["no", "false", "0", "n", "off", "none"].includes(normalized)) return false;
  return null;
}

export function parseNumberValue(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const stripped = normalized.replace(/,/g, "");
  if (!/^-?\d*\.?\d+$/.test(stripped)) return null;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOversellingPolicyValue(value: string): "allow" | "block" | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "allow" || normalized === "allowed") return "allow";
  if (normalized === "block" || normalized === "blocked") return "block";
  return null;
}

function findExistingProduct(
  values: Record<Exclude<ProductImportField, "skip">, string>,
  products: Product[],
  brands: Brand[]
): { product: Product | null; matchBy: "sku" | "name" | null } {
  const sku = values.sku.trim().toLowerCase();
  const name = values.name.trim().toLowerCase();
  const brandName = values.brand.trim().toLowerCase();

  if (sku) {
    const bySku = products.find((p) => (p.sku ?? "").trim().toLowerCase() === sku);
    if (bySku) return { product: bySku, matchBy: "sku" };
  }
  if (name) {
    const byName = products.find((p) => {
      if (p.name.trim().toLowerCase() !== name) return false;
      if (!brandName) return true;
      const brand = brands.find((b) => b.id === p.brand_id);
      return Boolean(brand && brand.name.trim().toLowerCase() === brandName);
    });
    if (byName) return { product: byName, matchBy: "name" };
  }
  return { product: null, matchBy: null };
}

export interface ValidateImportRowsParams {
  fileColumns: string[];
  mapping: ColumnMapping;
  rows: string[][];
  mode: DuplicateMode;
  categories: Category[];
  brands: Brand[];
  products: Product[];
  /** When true, unknown brands become a warning instead of a blocking error (they will be auto-created during import). */
  createMissingBrands?: boolean;
}

export function validateImportRows(params: ValidateImportRowsParams): ImportPreviewResult {
  const { fileColumns, mapping, rows, mode, categories, brands, products, createMissingBrands = false } = params;
  const mappedFields = new Set(
    fileColumns
      .filter((column) => mapping[column] && mapping[column] !== "skip")
      .map((column) => mapping[column])
  );

  const categoryNames = new Set(categories.map((c) => c.name.trim().toLowerCase()));
  const brandNames = new Set(brands.map((b) => b.name.trim().toLowerCase()));

  const seenNames = new Map<string, number>();
  const seenSkus = new Map<string, number>();

  const parsedRows: ParsedImportRow[] = [];
  let newCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  const errorRows: { rowIndex: number; message: string }[] = [];

  rows.forEach((cells, index) => {
    const rowIndex = index + 2;
    const values = {} as ParsedImportRow["values"];
    for (const field of Object.keys(FIELD_ALIASES) as Exclude<ProductImportField, "skip">[]) {
      values[field] = "";
    }

    for (let columnIndex = 0; columnIndex < fileColumns.length; columnIndex += 1) {
      const field = mapping[fileColumns[columnIndex]];
      if (!field || field === "skip") continue;
      values[field] = String(cells[columnIndex] ?? "").trim();
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    for (const field of mappedFields) {
      const columns = fileColumns.filter(column => mapping[column] === field);
      if (columns.length > 1) errors.push(`Multiple columns (${columns.join(", ")}) map to ${field}. Select one source column so its quantity cannot be overwritten.`);
    }

    if (mappedFields.has("name")) {
      const name = values.name;
      if (!name) {
        errors.push(`Missing product name; this row cannot be imported.`);
      } else {
        const nameKey = `${name.trim().toLowerCase()}${values.brand ? "|" + values.brand.trim().toLowerCase() : ""}`;
        if (seenNames.has(nameKey)) {
          warnings.push(`Duplicate name in file (also on row ${seenNames.get(nameKey)}); duplicate will be skipped at import.`);
        } else {
          seenNames.set(nameKey, rowIndex);
        }
      }
    }

    if (mappedFields.has("sku") && values.sku) {
      const skuKey = values.sku.trim().toLowerCase();
      if (seenSkus.has(skuKey)) {
        warnings.push(`Duplicate SKU in file (also on row ${seenSkus.get(skuKey)}); duplicate will be skipped at import.`);
      } else {
        seenSkus.set(skuKey, rowIndex);
      }
    }

    if (mappedFields.has("units_per_pack") && values.units_per_pack) {
      const parsed = parseNumberValue(values.units_per_pack);
      if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
        warnings.push(`"Units per pack" value "${values.units_per_pack}" is not a positive whole number; imported as not available.`);
      }
    }

    for (const field of ["default_purchase_price", "default_selling_price", "minimum_stock_level", "reorder_level"] as const) {
      if (mappedFields.has(field) && values[field]) {
        const parsed = parseNumberValue(values[field]);
        if (parsed === null || parsed < 0) {
          warnings.push(`Number "${values[field]}" for ${field} is invalid; imported as not available.`);
        }
      }
    }

    try {
      importedInitialStock(values);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid initial stock.");
    }

    for (const field of ["track_batch", "track_expiry"] as const) {
      if (mappedFields.has(field) && values[field]) {
        const parsed = parseBoolValue(values[field]);
        if (parsed === null) {
          warnings.push(`Value "${values[field]}" for ${field} is invalid (use yes/no/true/false/1/0); imported as not available.`);
        }
      }
    }

    if (mappedFields.has("overselling_policy") && values.overselling_policy) {
      const parsed = parseOversellingPolicyValue(values.overselling_policy);
      if (parsed === null) {
        warnings.push(`Value "${values.overselling_policy}" for overselling policy is invalid (use allow or block); imported as not available.`);
      }
    }

    if (mappedFields.has("brand") && values.brand) {
      if (!brandNames.has(values.brand.trim().toLowerCase())) {
        if (createMissingBrands) {
          warnings.push(`Brand "${values.brand}" is new and will be created automatically on import.`);
        } else {
          warnings.push(`Brand "${values.brand}" not found; product will be imported without a brand.`);
        }
      }
    }

    if (mappedFields.has("category") && values.category) {
      if (!categoryNames.has(values.category.trim().toLowerCase())) {
        warnings.push(`Category "${values.category}" not found; product will be imported without a category.`);
      }
    }

    const existing = findExistingProduct(values, products, brands);

    // Only importable rows (no hard errors) are counted toward new/update/skip.
    if (errors.length === 0) {
      if (existing.product) {
        if (mode === "skip") {
          warnings.push(`Already exists in your products (${existing.matchBy === "sku" ? "SKU" : "name"} match). Skipped.`);
          skipCount += 1;
        } else {
          updateCount += 1;
          if (values.initial_stock || values.initial_stock_subunit) {
            warnings.push("Initial stock is ignored when updating an existing product (stock is only set on create).");
          }
        }
      } else {
        newCount += 1;
      }
    }

    if (errors.length > 0) {
      errorCount += errors.length;
      errorRows.push({ rowIndex, message: errors.join(" ") });
    }
    warningCount += warnings.length;

    parsedRows.push({
      rowIndex,
      values,
      existingProductId: existing.product ? String(existing.product.id) : null,
      errors,
      warnings,
    });
  });

  return {
    fileColumns,
    rows: parsedRows,
    newCount,
    updateCount,
    skipCount,
    errorCount,
    warningCount,
    errorRows,
  };
}
