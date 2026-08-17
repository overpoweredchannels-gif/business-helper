// Product Foundation validation — single source of truth for product,
// category and brand input rules.
//
// Used by:
//   - client: src/app/page.tsx (form handlers)
//   - server: src/app/api/products/validate/route.ts
// The database mirrors these rules with CHECK constraints and unique
// indexes in src/lib/products/schema.sql — keep the three in sync.

export const MAX_NAME_LENGTH = 200;
export const MAX_BRAND_CATEGORY_NAME_LENGTH = 100;
export const MAX_SKU_LENGTH = 100;
export const MAX_BARCODE_LENGTH = 100;
export const MAX_UNIT_TYPE_LENGTH = 50;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const requireLength = (value: string | null, field: string, max: number, required: boolean): string | null => {
  if (value === null || value.length === 0) {
    return required ? `${field} is required` : null;
  }
  if (value.length > max) {
    return `${field} must be ${max} characters or fewer`;
  }
  return null;
};

const optionalNumberRule = (value: number | null, field: string, min: number): string | null => {
  if (value === null) return null;
  if (value < min) return `${field} must be ${min} or greater`;
  return null;
};

// ─── Product ────────────────────────────────────────────────────────────────

export interface ProductInput {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unitType: string;
  subunitType?: string | null;
  unitsPerPack?: string | number | null;
  minimumStockLevel?: string | number | null;
  reorderLevel?: string | number | null;
  lastPurchasePrice?: string | number | null;
  defaultPurchasePrice?: string | number | null;
  defaultSellingPrice?: string | number | null;
}

export const validateProductInput = (input: ProductInput): ValidationResult => {
  const errors: string[] = [];
  const name = normalizeOptionalText(input.name);
  const sku = normalizeOptionalText(input.sku);
  const barcode = normalizeOptionalText(input.barcode);
  const unitType = normalizeOptionalText(input.unitType);
  const subunitType = normalizeOptionalText(input.subunitType);
  const unitsPerPack = normalizeOptionalNumber(input.unitsPerPack);
  const minimumStockLevel = normalizeOptionalNumber(input.minimumStockLevel);
  const reorderLevel = normalizeOptionalNumber(input.reorderLevel);
  const lastPurchasePrice = normalizeOptionalNumber(input.lastPurchasePrice);
  const defaultPurchasePrice = normalizeOptionalNumber(input.defaultPurchasePrice);
  const defaultSellingPrice = normalizeOptionalNumber(input.defaultSellingPrice);

  const nameError = requireLength(name, "Product name", MAX_NAME_LENGTH, true);
  if (nameError) errors.push(nameError);

  const unitError = requireLength(unitType, "Unit type", MAX_UNIT_TYPE_LENGTH, true);
  if (unitError) errors.push(unitError);

  const subunitError = requireLength(subunitType, "Subunit type", MAX_UNIT_TYPE_LENGTH, false);
  if (subunitError) errors.push(subunitError);

  const skuError = requireLength(sku, "SKU", MAX_SKU_LENGTH, false);
  if (skuError) errors.push(skuError);

  const barcodeError = requireLength(barcode, "Barcode", MAX_BARCODE_LENGTH, false);
  if (barcodeError) errors.push(barcodeError);

  const unitsPerPackRule = optionalNumberRule(unitsPerPack, "Units per pack", 1);
  if (unitsPerPackRule) errors.push(unitsPerPackRule);

  const minimumStockRule = optionalNumberRule(minimumStockLevel, "Minimum stock level", 0);
  if (minimumStockRule) errors.push(minimumStockRule);

  const reorderRule = optionalNumberRule(reorderLevel, "Reorder level", 0);
  if (reorderRule) errors.push(reorderRule);

  const lastPurchasePriceRule = optionalNumberRule(lastPurchasePrice, "Purchase price", 0);
  if (lastPurchasePriceRule) errors.push(lastPurchasePriceRule);

  const defaultPurchasePriceRule = optionalNumberRule(defaultPurchasePrice, "Default purchase price", 0);
  if (defaultPurchasePriceRule) errors.push(defaultPurchasePriceRule);

  const defaultSellingPriceRule = optionalNumberRule(defaultSellingPrice, "Selling price", 0);
  if (defaultSellingPriceRule) errors.push(defaultSellingPriceRule);

  return { ok: errors.length === 0, errors };
};

// ─── Brand / Category ───────────────────────────────────────────────────────

export const validateBrandName = (value: string): ValidationResult => {
  const name = normalizeOptionalText(value);
  const error = requireLength(name, "Brand name", MAX_BRAND_CATEGORY_NAME_LENGTH, true);
  return error ? { ok: false, errors: [error] } : { ok: true, errors: [] };
};

export const validateCategoryName = (value: string): ValidationResult => {
  const name = normalizeOptionalText(value);
  const error = requireLength(name, "Category name", MAX_BRAND_CATEGORY_NAME_LENGTH, true);
  return error ? { ok: false, errors: [error] } : { ok: true, errors: [] };
};
