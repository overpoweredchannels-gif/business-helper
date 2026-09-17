// TradeOS ERP — Universal Import/Export Type Definitions
//
// Generic types that work across all entities. Each entity registers a
// `EntityImportConfig` defining its fields, validation, duplicate detection,
// and Supabase upsert logic. The shared processor and wizard components are
// completely entity-agnostic.

export type FieldType =
  | "text"
  | "number"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "select"
  | "multiselect"
  | "uuid"
  | "json";

export interface ImportFieldDef<TEntity = unknown> {
  /** Unique key matching the database column or nested path. */
  key: string;
  /** Human-readable label for UI. */
  label: string;
  /** Data type for parsing/validation. */
  type: FieldType;
  /** Whether this field is required for a valid row. */
  required?: boolean;
  /** Whether this field can be used as a unique identifier for duplicate detection. */
  unique?: boolean;
  /** For select/multiselect: options or async fetcher. */
  options?: string[] | ((orgId: string) => Promise<string[]>);
  /** Default value if cell is empty. */
  defaultValue?: unknown;
  /** Custom parser: raw string -> typed value. Return null/undefined to use default. */
  parse?: (raw: string, row: Record<string, string>, ctx: ImportContext) => unknown;
  /** Custom validator: typed value -> error message or null. */
  validate?: (value: unknown, row: Record<string, unknown>, ctx: ImportContext) => string | null;
  /** Transform before upsert (e.g. resolve FK names to UUIDs). */
  transform?: (value: unknown, row: Record<string, unknown>, ctx: ImportContext) => Promise<unknown>;
  /** Show in preview table. */
  preview?: boolean;
  /** Column width hint for preview. */
  width?: number;
  /** Help text for mapping UI. */
  help?: string;
}

export interface EntityImportConfig<TEntity = unknown> {
  /** Unique entity identifier (e.g. "products", "customers", "sales_invoices"). */
  entityKey: string;
  /** Human-readable name for UI. */
  entityName: string;
  /** Database table name. */
  tableName: string;
  /** Supabase columns to select for existing records (for duplicate detection). */
  existingColumns: string;
  /** Fields definition - order matters for preview columns. */
  fields: ImportFieldDef[];
  /** Fields that uniquely identify a record for duplicate detection (SKU, name+brand, etc.). */
  uniqueKeys: string[][];
  /** Default duplicate handling mode. */
  defaultDuplicateMode: "skip" | "update" | "error";
  /** Whether to allow creating missing reference records (e.g. brands, categories). */
  allowCreateReferences?: boolean;
  /** Custom function to build upsert payload from parsed row. */
  buildUpsertPayload?: (row: ParsedRow, ctx: ImportContext) => Promise<Record<string, unknown>>;
  /** Optional custom create flow for entities that also write child records. */
  createRecord?: (row: ParsedRow, payload: Record<string, unknown>, ctx: ImportContext) => Promise<unknown>;
  /** Custom function to check if row matches existing record. */
  findExisting?: (row: ParsedRow, ctx: ImportContext) => Promise<unknown>;
  /** Custom function to apply updates (for update mode). */
  applyUpdate?: (existing: unknown, payload: Record<string, unknown>, ctx: ImportContext) => Promise<unknown>;
  /** Post-import hook (e.g. initial stock adjustment for products). */
  postImportHook?: (created: unknown[], updated: unknown[], ctx: ImportContext) => Promise<void>;
  /** Maximum rows per file. */
  maxRows?: number;
  /** Optional batch size for append-only entities with no duplicate keys. */
  insertBatchSize?: number;
  /** Export configuration. */
  export?: EntityExportConfig;
}

export interface EntityExportConfig {
  /** Columns to export in order. */
  columns: ExportColumnDef[];
  /** Default filename prefix. */
  filenamePrefix: string;
  /** Optional SQL query or function to fetch export data. */
  fetchData?: (orgId: string, filters: ExportFilters) => Promise<unknown[]>;
}

export interface ExportColumnDef {
  key: string;
  label: string;
  /** Optional transform for export display. */
  transform?: (value: unknown, row: Record<string, unknown>) => string;
}

export interface ExportFilters {
  dateFrom?: string;
  dateTo?: string;
  customerIds?: string[];
  salesmanIds?: string[];
  supplierIds?: string[];
  [key: string]: unknown;
}

export interface ImportContext {
  previewOnly?: boolean;
  orgId: string;
  supabase: any;
  actorProfileId?: string;
  createMissingRefs?: boolean;
  duplicateMode: "skip" | "update" | "error";
  fileName: string;
  fileHeaders: string[];
  mapping: ColumnMapping;
  existingCache: Map<string, unknown>;
  refCaches: Map<string, Map<string, string>>; // e.g. brand name -> id
  stats: ImportStats;
  auditLog?: (params: AuditLogParams) => Promise<void>;
}

export interface ParsedRow {
  rowIndex: number;
  raw: Record<string, string>;           // Original trimmed cell values by file column
  values: Record<string, unknown>;       // Parsed/typed values by field key
  errors: string[];
  warnings: string[];
  existingId?: string | number | null;   // Matched existing record PK
  status: "new" | "update" | "skip" | "error" | "warning";
}

export interface ColumnMapping {
  [fileColumn: string]: string; // file column -> field key (or "skip")
}

export interface ImportStats {
  totalRows: number;
  newCount: number;
  updateCount: number;
  skipCount: number;
  errorCount: number;
  warningCount: number;
}

export interface ImportPreviewResult {
  fileColumns: string[];
  rows: ParsedRow[];
  stats: ImportStats;
  errorRows: { rowIndex: number; message: string }[];
}

export interface ImportRunResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  failures: { rowLabel: string; message: string }[];
}

export interface AuditLogParams {
  action: string;
  entity_type: string;
  entity_id?: string | number | null;
  entity_label?: string | null;
  description?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
}

// Supabase client type (avoid direct import for portability)
export type SupabaseClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: any) => Promise<any>;
  auth: any;
};

// Re-export from existing import-wizard types for compatibility
export type { ProductImportField, ColumnMapping as LegacyColumnMapping, DuplicateMode } from "@/lib/import-wizard/types";
