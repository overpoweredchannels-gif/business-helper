// TradeOS — Import Wizard: header normalization, column-mapping guesser, and
// row validation for product imports. Pure functions (no I/O) so they can be
// unit-tested without a database.

import type { Category, Brand, Product } from "@/lib/tradeos/types";
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
  { value: "units_per_pack", label: "Units Per Pack" },
  { value: "default_purchase_price", label: "Purchase Price" },
  { value: "default_selling_price", label: "Selling Price" },
  { value: "minimum_stock_level", label: "Minimum Stock Level" },
  { value: "reorder_level", label: "Reorder Level" },
  { value: "track_batch", label: "Track Batch" },
  { value: "track_expiry", label: "Track Expiry" },
  { value: "overselling_policy", label: "Overselling Policy" },
  { value: "initial_stock", label: "Initial Stock" },
  { value: "skip", label: "Do not import" },
];

const FIELD_ALIASES: Record<Exclude<ProductImportField, "skip">, string[]> = {
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
  sku: ["sku", "code", "item code", "product code", "sku code", "product sku"],
  barcode: ["barcode", "bar code", "ean", "ean13", "upc", "barcode number"],
  brand: ["brand", "brand name", "manufacturer", "make"],
  category: ["category", "category name", "product category", "type"],
  unit_type: ["unit type", "unit", "uom", "unit of measure", "unitofmeasure"],
  units_per_pack: ["units per pack", "unitspack", "pack size", "pieces per pack", "pcs per pack"],
  default_purchase_price: [
    "purchase price",
    "cost price",
    "buying price",
    "cost",
    "purchase price pkr",
    "purchaseprice",
  ],
  default_selling_price: [
    "selling price",
    "sale price",
    "retail price",
    "price",
    "selling price pkr",
    "sellingprice",
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
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
    Exclude<ProductImportField, "skip">,
    string[],
  ][]) {
    if (aliases.includes(normalized)) return field;
  }
  return null;
}

export function guessColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    mapping[header] = guessFieldForHeader(header) ?? "skip";
  }
  return mapping;
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
}

export function validateImportRows(params: ValidateImportRowsParams): ImportPreviewResult {
  const { fileColumns, mapping, rows, mode, categories, brands, products } = params;
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

    if (mappedFields.has("name")) {
      const name = values.name;
      if (!name) {
        errors.push(`Missing required "name" value.`);
      } else {
        const nameKey = `${name.trim().toLowerCase()}${values.brand ? "|" + values.brand.trim().toLowerCase() : ""}`;
        if (seenNames.has(nameKey)) {
          errors.push(`Duplicate product name in file (also on row ${seenNames.get(nameKey)}).`);
        } else {
          seenNames.set(nameKey, rowIndex);
        }
      }
    }

    if (mappedFields.has("sku") && values.sku) {
      const skuKey = values.sku.trim().toLowerCase();
      if (seenSkus.has(skuKey)) {
        errors.push(`Duplicate SKU in file (also on row ${seenSkus.get(skuKey)}).`);
      } else {
        seenSkus.set(skuKey, rowIndex);
      }
    }

    if (mappedFields.has("units_per_pack") && values.units_per_pack) {
      const parsed = parseNumberValue(values.units_per_pack);
      if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
        errors.push(`"Units per pack" must be a positive whole number, got "${values.units_per_pack}".`);
      }
    }

    for (const field of ["default_purchase_price", "default_selling_price", "minimum_stock_level", "reorder_level"] as const) {
      if (mappedFields.has(field) && values[field]) {
        const parsed = parseNumberValue(values[field]);
        if (parsed === null || parsed < 0) {
          errors.push(`Invalid number "${values[field]}" for ${field}.`);
        }
      }
    }

    if (mappedFields.has("initial_stock") && values.initial_stock) {
      const parsed = parseNumberValue(values.initial_stock);
      if (parsed === null || parsed < 0) {
        errors.push(`Invalid initial stock "${values.initial_stock}" (must be a non-negative number).`);
      }
    }

    for (const field of ["track_batch", "track_expiry"] as const) {
      if (mappedFields.has(field) && values[field]) {
        const parsed = parseBoolValue(values[field]);
        if (parsed === null) {
          errors.push(`Invalid value "${values[field]}" for ${field} (use yes/no/true/false/1/0).`);
        }
      }
    }

    if (mappedFields.has("overselling_policy") && values.overselling_policy) {
      const parsed = parseOversellingPolicyValue(values.overselling_policy);
      if (parsed === null) {
        errors.push(`Invalid value "${values.overselling_policy}" for overselling policy (use allow or block).`);
      }
    }

    if (mappedFields.has("brand") && values.brand) {
      if (!brandNames.has(values.brand.trim().toLowerCase())) {
        errors.push(`Unknown brand "${values.brand}". Create the brand first or fix the name.`);
      }
    }

    if (mappedFields.has("category") && values.category) {
      if (!categoryNames.has(values.category.trim().toLowerCase())) {
        errors.push(`Unknown category "${values.category}". Create the category first or fix the name.`);
      }
    }

    const existing = findExistingProduct(values, products, brands);
    if (existing.product) {
      if (mode === "skip") {
        warnings.push(`Already exists in your products (${existing.matchBy === "sku" ? "SKU" : "name"} match). Skipped.`);
        skipCount += 1;
      } else {
        updateCount += 1;
        if (values.initial_stock) {
          warnings.push("Initial stock is ignored when updating an existing product (stock is only set on create).");
        }
      }
    } else {
      newCount += 1;
    }

    if (errors.length > 0) {
      errorCount += errors.length;
      errorRows.push({ rowIndex, message: errors.join(" ") });
    }

    parsedRows.push({
      rowIndex,
      values,
      existingProductId: existing.product ? Number(existing.product.id) : null,
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
    errorRows,
  };
}
