// TradeOS — Import Wizard: shared types for the product import flow.

export type ProductImportField =
  | "name"
  | "sku"
  | "barcode"
  | "brand"
  | "category"
  | "unit_type"
  | "units_per_pack"
  | "default_purchase_price"
  | "default_selling_price"
  | "minimum_stock_level"
  | "reorder_level"
  | "track_batch"
  | "track_expiry"
  | "overselling_policy"
  | "initial_stock"
  | "skip";

export type ColumnMapping = Record<string, ProductImportField>;

export type DuplicateMode = "skip" | "update";

export interface ParsedImportRow {
  /** 1-based row number as shown in the spreadsheet (includes the header row). */
  rowIndex: number;
  /** Raw (trimmed) cell values keyed by mapped field. */
  values: Record<Exclude<ProductImportField, "skip">, string>;
  /** Matched existing product id (by SKU or name+brand), when one exists. */
  existingProductId: number | null;
  errors: string[];
  warnings: string[];
}

export interface ImportPreviewResult {
  fileColumns: string[];
  rows: ParsedImportRow[];
  newCount: number;
  updateCount: number;
  skipCount: number;
  errorCount: number;
  warningCount: number;
  errorRows: { rowIndex: number; message: string }[];
}

export interface ImportRunFailure {
  rowLabel: string;
  message: string;
}

export interface ImportRunResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  failures: ImportRunFailure[];
}

export interface SavedImportTemplate {
  id: string;
  name: string;
  mapping: ColumnMapping;
}
