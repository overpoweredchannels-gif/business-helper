"use client";

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand, Category, Product } from "@/lib/tradeos/types";
import { parseCsv } from "@/lib/import-wizard/csv";
import type {
  ColumnMapping,
  DuplicateMode,
  ImportPreviewResult,
  ImportRunResult,
  ProductImportField,
  SavedImportTemplate,
} from "@/lib/import-wizard/types";
import {
  IMPORT_FIELD_OPTIONS,
  guessColumnMapping,
  validateImportRows,
} from "@/lib/import-wizard/validation";
import {
  deleteTemplate,
  getDefaultTemplateId,
  getSavedTemplates,
  renameTemplate,
  replaceTemplate,
  saveTemplate,
  setDefaultTemplateId,
} from "@/lib/import-wizard/templates";
const MAX_PREVIEW_ROWS = 100;
const MAX_FILE_ROWS = 5000;

interface ImportWizardProps {
  supabase: SupabaseClient;
  organizationId: string | null;
  categories: Category[];
  brands: Brand[];
  products: Product[];
  actorProfileId: string | null;
  createAuditLog: (params: {
    action: string;
    entity_type: string;
    entity_id?: string | number | null;
    entity_label?: string | null;
    description?: string | null;
    old_values?: Record<string, unknown> | null;
    new_values?: Record<string, unknown> | null;
  }) => Promise<void>;
  onImported: () => void;
}

type Step = "file" | "mapping" | "preview" | "done";

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  update: "Update",
  skipped: "Skipped",
  error: "Error",
  warning: "Import (fix)",
};

const PREVIEW_FIELD_LABELS: Partial<Record<ProductImportField, string>> = {
  name: "Name",
  sku: "SKU",
  barcode: "Barcode",
  brand: "Brand",
  category: "Category",
  unit_type: "Unit Type",
  subunit_type: "Subunit Type",
  units_per_pack: "Units/Pack",
  default_purchase_price: "Purchase",
  default_selling_price: "Selling",
  minimum_stock_level: "Min Stock",
  reorder_level: "Reorder",
  initial_stock: "Initial Stock",
  track_batch: "Track Batch",
  track_expiry: "Track Expiry",
  overselling_policy: "Oversell",
};

export default function ImportWizard({
  supabase,
  organizationId,
  categories,
  brands,
  products,
  actorProfileId,
  createAuditLog,
  onImported,
}: ImportWizardProps) {
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mode, setMode] = useState<DuplicateMode>("skip");
  const [createMissingBrands, setCreateMissingBrands] = useState(true);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportRunResult | null>(null);
  const [templates, setTemplates] = useState<SavedImportTemplate[]>(() => getSavedTemplates());
  const [templateName, setTemplateName] = useState("");
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [defaultTemplateId, setDefaultTemplateIdState] = useState<string | null>(() =>
    getDefaultTemplateId()
  );
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewRows = useMemo(
    () => (preview ? preview.rows.slice(0, MAX_PREVIEW_ROWS) : []),
    [preview]
  );

  // Mapped fields shown as columns in the preview table, in a stable order.
  type ValueField = Exclude<ProductImportField, "skip">;
  const previewPreviewFields = useMemo(() => {
    if (!preview) return [] as ValueField[];
    const order: ValueField[] = [
      "name",
      "sku",
      "barcode",
      "brand",
      "category",
      "unit_type",
      "subunit_type",
      "units_per_pack",
      "default_purchase_price",
      "default_selling_price",
      "minimum_stock_level",
      "reorder_level",
      "initial_stock",
      "track_batch",
      "track_expiry",
      "overselling_policy",
    ];
    const used = new Set(preview.rows[0] ? Object.keys(preview.rows[0].values) : []);
    return order.filter((field) => used.has(field));
  }, [preview]);

  const previewFieldLabel = (field: ValueField) => PREVIEW_FIELD_LABELS[field] ?? field;

  const resetFile = () => {
    setStep("file");
    setFileName("");
    setFileError(null);
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setPreview(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = async (file: File | undefined) => {
    setFileError(null);
    setPreview(null);
    setImportResult(null);
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!/\.(csv|xlsx|xls|ods)$/.test(lower)) {
      setFileError("Unsupported file type. Use .csv, .xlsx, .xls, or .ods files.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      let matrix: string[][];
      if (lower.endsWith(".csv")) {
        const text = new TextDecoder("utf-8").decode(buffer);
        matrix = parseCsv(text);
      } else {
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
          setFileError("The file has no sheets.");
          return;
        }
        const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
          raw: true,
        });
        matrix = raw.map((row) => row.map((cell) => String(cell ?? "").trim()));
      }

      const nonEmptyRows = matrix.filter((row) => row.some((cell) => cell.trim() !== ""));
      if (nonEmptyRows.length < 2) {
        setFileError("The file needs a header row plus at least one data row.");
        return;
      }

      const headerRow = nonEmptyRows[0].map((cell) => cell.trim());
      const body = nonEmptyRows.slice(1);
      if (body.length > MAX_FILE_ROWS) {
        setFileError(`The file has ${body.length} data rows; the limit is ${MAX_FILE_ROWS}.`);
        return;
      }

      setFileName(file.name);
      setHeaders(headerRow);
      setDataRows(body);
      setStep("mapping");
      const defaultTemplate = templates.find((t) => t.id === defaultTemplateId);
      if (defaultTemplate) {
        setMapping({ ...defaultTemplate.mapping });
        setTemplateMessage(`Default template "${defaultTemplate.name}" applied.`);
      } else if (defaultTemplateId === "default") {
        setMapping(guessColumnMapping(headerRow));
        setTemplateMessage("Default (guessed) template applied.");
      } else {
        setMapping({});
        setTemplateMessage(null);
      }
    } catch (err) {
      setFileError(err instanceof Error ? `Failed to read file: ${err.message}` : "Failed to read file.");
    }
  };

  const setFieldForColumn = (column: string, field: ProductImportField) => {
    setMapping((prev) => ({ ...prev, [column]: field }));
  };

  const handleRunPreview = () => {
    setPreview(
      validateImportRows({
        fileColumns: headers,
        mapping,
        rows: dataRows,
        mode,
        categories,
        brands,
        products,
        createMissingBrands,
      })
    );
    setStep("preview");
  };

  const handleLoadTemplate = (templateId: string) => {
    if (templateId === "default") {
      setMapping(guessColumnMapping(headers));
      setTemplateMessage("Default (guessed) template loaded.");
      return;
    }
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setMapping({ ...template.mapping });
    setTemplateMessage(`Template "${template.name}" loaded.`);
  };

  const handleSaveTemplate = () => {
    const next = saveTemplate(templateName, mapping);
    setTemplates(next);
    setTemplateName("");
    setTemplateMessage(`Template saved (${next.length} total).`);
  };

  const handleStartRename = (template: SavedImportTemplate) => {
    setEditingTemplateId(template.id);
    setEditingTemplateName(template.name);
  };

  const handleConfirmRename = (templateId: string) => {
    if (!editingTemplateName.trim()) return;
    setTemplates(renameTemplate(templateId, editingTemplateName.trim()));
    setEditingTemplateId(null);
    setEditingTemplateName("");
    setTemplateMessage("Template renamed.");
  };

  const handleReplaceTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    setTemplates(replaceTemplate(templateId, mapping));
    setTemplateMessage(`Template "${template?.name ?? ""}" replaced with the current mapping.`);
  };

  const handleToggleDefaultTemplate = (templateId: string) => {
    const nextDefault = defaultTemplateId === templateId ? null : templateId;
    setDefaultTemplateIdState(nextDefault);
    setDefaultTemplateId(nextDefault);
    setTemplateMessage(
      nextDefault === null ? "Default template cleared." : "Default template set."
    );
  };

  const handleDeleteTemplate = (template: SavedImportTemplate) => {
    if (!window.confirm(`Delete template "${template.name}"?`)) return;
    setTemplates(deleteTemplate(template.id));
    if (defaultTemplateId === template.id) {
      setDefaultTemplateIdState(null);
      setDefaultTemplateId(null);
    }
    setTemplateMessage("Template deleted.");
  };

  const runImport = async () => {
    if (!preview || !organizationId) return;
    setImporting(true);
    setImportResult(null);

    const brandIdByName = new Map(brands.map((b) => [b.name.trim().toLowerCase(), b.id]));
    const categoryIdByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));

    // Brands created on the fly (auto-create option), keyed by lowercased name.
    const createdBrandIds = new Map<string, string>();

    const ensureBrand = async (name: string): Promise<string | null> => {
      const key = name.trim().toLowerCase();
      if (brandIdByName.has(key)) return brandIdByName.get(key)!;
      if (createdBrandIds.has(key)) return createdBrandIds.get(key)!;
      if (!createMissingBrands) return null;
      const { data, error } = await supabase
        .from("brands")
        .insert({ organization_id: organizationId, name: name.trim() })
        .select("id")
        .single();
      if (error || !data) return null;
      createdBrandIds.set(key, data.id);
      return data.id;
    };

    const result: ImportRunResult = { created: 0, updated: 0, skipped: 0, failed: 0, failures: [] };

    // Track product identity already imported during this run so repeated
    // names/SKUs in the file are skipped instead of colliding with the DB
    // unique indexes and failing the whole batch.
    const importedNameKeys = new Set<string>();
    const importedSkuKeys = new Set<string>();
    let deDuplicated = 0;

    for (const row of preview.rows) {
      if (row.errors.length > 0) {
        result.failed += 1;
        result.failures.push({ rowLabel: `Row ${row.rowIndex}`, message: row.errors.join(" ") });
        continue;
      }
      const v = row.values;
      const brandId = v.brand ? (brandIdByName.get(v.brand.trim().toLowerCase()) ?? null) : null;
      const categoryId = v.category ? categoryIdByName.get(v.category.trim().toLowerCase()) ?? null : null;

      // If the brand doesn't exist yet and auto-create is enabled, insert it.
      const finalBrandId = brandId ?? (v.brand ? await ensureBrand(v.brand) : null);

      const nameKey = `${v.name.trim().toLowerCase()}${v.brand ? "|" + v.brand.trim().toLowerCase() : ""}`;
      const skuKey = v.sku.trim().toLowerCase();
      if (skuKey && importedSkuKeys.has(skuKey)) {
        deDuplicated += 1;
        result.failures.push({
          rowLabel: `Row ${row.rowIndex}`,
          message: `Duplicate SKU "${v.sku}" already imported from this file; row skipped.`,
        });
        continue;
      }
      if (importedNameKeys.has(nameKey)) {
        deDuplicated += 1;
        result.failures.push({
          rowLabel: `Row ${row.rowIndex}`,
          message: `Duplicate product name "${v.name}" already imported from this file; row skipped.`,
        });
        continue;
      }

      const toNumberOrNull = (value: string): number | null => {
        if (!value) return null;
        const parsed = Number(value.replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
      };
      const toBoolOrNull = (value: string): boolean | null => {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return null;
        if (["yes", "true", "1", "y", "on"].includes(normalized)) return true;
        if (["no", "false", "0", "n", "off", "none"].includes(normalized)) return false;
        return null;
      };
      const toPolicyOrNull = (value: string): "allow" | "block" | null => {
        const normalized = value.trim().toLowerCase();
        if (normalized === "allow" || normalized === "allowed") return "allow";
        if (normalized === "block" || normalized === "blocked") return "block";
        return null;
      };

      const payload = {
        name: v.name.trim(),
        sku: v.sku.trim() || null,
        barcode: v.barcode.trim() || null,
        brand_id: finalBrandId,
        category_id: categoryId,
        unit_type: v.unit_type.trim() || null,
        subunit_type: v.subunit_type.trim() || null,
        units_per_pack: toNumberOrNull(v.units_per_pack),
        default_purchase_price: toNumberOrNull(v.default_purchase_price),
        last_purchase_price: toNumberOrNull(v.default_purchase_price),
        default_selling_price: toNumberOrNull(v.default_selling_price),
        minimum_stock_level: toNumberOrNull(v.minimum_stock_level),
        reorder_level: toNumberOrNull(v.reorder_level),
        track_batch: toBoolOrNull(v.track_batch),
        track_expiry: toBoolOrNull(v.track_expiry),
        overselling_policy: toPolicyOrNull(v.overselling_policy),
      };

      const initialStock = toNumberOrNull(v.initial_stock) ?? 0;

      try {
        if (row.existingProductId) {
          // In update mode, only overwrite fields the file actually provides —
          // empty cells must not wipe existing product data.
          const updatable: Record<string, unknown> = { ...payload };
          if (v.name) updatable.name = v.name.trim();
          if (v.sku.trim()) updatable.sku = v.sku.trim();
          if (v.barcode.trim()) updatable.barcode = v.barcode.trim();
          if (finalBrandId) updatable.brand_id = finalBrandId;
          if (categoryId) updatable.category_id = categoryId;
          if (v.unit_type.trim()) updatable.unit_type = v.unit_type.trim();
          if (v.subunit_type.trim()) updatable.subunit_type = v.subunit_type.trim();
          for (const key of [
            "units_per_pack",
            "default_purchase_price",
            "last_purchase_price",
            "default_selling_price",
            "minimum_stock_level",
            "reorder_level",
          ] as const) {
            const raw = (v as unknown as Record<string, string>)[key];
            if (raw) updatable[key] = toNumberOrNull(raw);
          }
          if (v.track_batch.trim()) updatable.track_batch = toBoolOrNull(v.track_batch);
          if (v.track_expiry.trim()) updatable.track_expiry = toBoolOrNull(v.track_expiry);
          if (v.overselling_policy.trim()) updatable.overselling_policy = toPolicyOrNull(v.overselling_policy);

          const { error: updateError } = await supabase
            .from("products")
            .update({ ...updatable, updated_at: new Date().toISOString() })
            .eq("id", row.existingProductId)
            .eq("organization_id", organizationId);
          if (updateError) throw updateError;
          result.updated += 1;
          importedNameKeys.add(nameKey);
          if (skuKey) importedSkuKeys.add(skuKey);
        } else {
          const { data: inserted, error: insertError } = await supabase
            .from("products")
            .insert({ ...payload, organization_id: organizationId })
            .select("id")
            .single();
          if (insertError) throw insertError;
          result.created += 1;
          importedNameKeys.add(nameKey);
          if (skuKey) importedSkuKeys.add(skuKey);

          if (initialStock > 0 && inserted?.id) {
            const { error: adjustError } = await supabase.rpc("adjust_inventory", {
              p_organization_id: organizationId,
              p_product_id: String(inserted.id),
              p_quantity_delta: initialStock,
              p_reason: "Initial stock imported from product import file",
              p_created_by: actorProfileId,
            });
            if (adjustError) {
              result.failures.push({
                rowLabel: `Row ${row.rowIndex}`,
                message: `Product created but initial stock failed: ${adjustError.message}`,
              });
            }
          }
        }
      } catch (err) {
        result.failed += 1;
        const details =
          typeof err === "object" && err !== null
            ? [
                (err as { message?: unknown }).message,
                (err as { details?: unknown }).details,
                (err as { hint?: unknown }).hint,
              ]
                .filter((part) => part !== undefined && part !== null && part !== "")
                .join(" ")
            : String(err);
        result.failures.push({
          rowLabel: `Row ${row.rowIndex}`,
          message: details || "Failed to import row",
        });
      }
    }

    if (deDuplicated > 0) {
      result.failures.push({
        rowLabel: "Import",
        message: `${deDuplicated} duplicate row(s) were skipped because a product with the same name or SKU was already imported from this file.`,
      });
    }

    result.skipped = preview.skipCount + deDuplicated;
    setImportResult(result);
    setImporting(false);
    setStep("done");

    await createAuditLog({
      action: "imported",
      entity_type: "product_import",
      entity_id: null,
      entity_label: fileName,
      description: `Imported products from ${fileName}: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed.`,
      new_values: {
        file_name: fileName,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    onImported();
  };

  const mappedFieldCount = headers.filter((header) => mapping[header] && mapping[header] !== "skip").length;

  return (
    <div className="space-y-6">
      <div className="rounded border border-border bg-card p-4">
        <h3 className="mb-1 text-lg font-medium text-foreground">Import Products</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Upload a CSV, Excel (.xlsx / .xls), or OpenDocument (.ods) file to create or update products in bulk.
          Map your columns, preview and fix validation errors, then import. Initial stock quantities are recorded
          through the stock ledger as adjustments, so your inventory stays consistent.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.ods"
            onChange={(e) => handleFileChange(e.target.files?.[0])}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-primary/90 sm:w-auto"
          />
          {fileName && (
            <span className="text-sm text-muted-foreground">Selected: {fileName}</span>
          )}
        </div>
        {fileError && <p className="mt-3 text-sm text-destructive">{fileError}</p>}
      </div>

      {step === "mapping" && (
        <div className="rounded border border-border bg-card p-4">
          <h3 className="mb-3 text-lg font-medium text-foreground">Map Columns</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            {headers.length} columns, {dataRows.length} data rows detected. Tell TradeOS what each column means.
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span>Load template</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleLoadTemplate(e.target.value);
                }}
                className="rounded border border-border px-3 py-2"
              >
                <option value="">Select a template...</option>
                <option value="default">Default (guessed)</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span>Save current mapping as</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name"
                  className="rounded border border-border px-3 py-2"
                />
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className="rounded border border-primary px-3 py-2 text-sm text-primary hover:bg-primary/5 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </label>
            {templates.length > 0 && (
              <div className="w-full">
                <span className="text-xs text-muted-foreground">Saved templates</span>
                <ul className="mt-1 space-y-1">
                  {templates.map((template) => {
                    const isDefault = defaultTemplateId === template.id;
                    return (
                      <li
                        key={template.id}
                        className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5 text-sm"
                      >
                        {editingTemplateId === template.id ? (
                          <>
                            <input
                              type="text"
                              value={editingTemplateName}
                              onChange={(e) => setEditingTemplateName(e.target.value)}
                              autoFocus
                              placeholder="Template name"
                              className="min-w-[120px] flex-1 rounded border border-border px-2 py-1 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => handleConfirmRename(template.id)}
                              disabled={!editingTemplateName.trim()}
                              className="rounded bg-primary px-2 py-1 text-xs text-white hover:bg-primary/90 disabled:opacity-40"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTemplateId(null);
                                setEditingTemplateName("");
                              }}
                              className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 font-medium text-foreground/90">
                              {template.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleLoadTemplate(template.id)}
                              className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30"
                            >
                              Load
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReplaceTemplate(template.id)}
                              title="Replace this template's mapping with the current mapping"
                              className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30"
                            >
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartRename(template)}
                              className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted/30"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleDefaultTemplate(template.id)}
                              title={
                                isDefault
                                  ? "Remove as the default template"
                                  : "Use as the default template (applied automatically when a file is selected)"
                              }
                              className={`rounded border px-2 py-1 text-xs ${
                                isDefault
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:bg-muted/30"
                              }`}
                            >
                              {isDefault ? "Default" : "Set default"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(template)}
                              className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/5"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {templateMessage && <p className="text-xs text-muted-foreground">{templateMessage}</p>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">File Column</th>
                  <th className="py-2 font-medium">Import As</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => (
                  <tr key={header} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-medium text-foreground">{header}</td>
                    <td className="py-2">
                      <select
                        value={mapping[header] ?? "skip"}
                        onChange={(e) => setFieldForColumn(header, e.target.value as ProductImportField)}
                        className="rounded border border-border px-2 py-1.5"
                      >
                        {IMPORT_FIELD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">Duplicate handling</span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={mode === "skip"}
                  onChange={() => setMode("skip")}
                  className="h-4 w-4"
                />
                Skip rows that already exist
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={mode === "update"}
                  onChange={() => setMode("update")}
                  className="h-4 w-4"
                />
                Update existing products (by SKU, then by name + brand)
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createMissingBrands}
                  onChange={(e) => setCreateMissingBrands(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Auto-create brands that don&apos;t exist yet
              </label>
              <p className="text-xs text-muted-foreground">
                Price per piece/cotton, purchase value, on-hand qty and packing are detected automatically from
                headers like &quot;Price per Piece&quot;, &quot;Units Per Pack&quot;, &quot;Company&quot; or
                &quot;Qty on Hand&quot;.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunPreview}
              disabled={mappedFieldCount === 0 || !headers.some((h) => mapping[h] === "name")}
              className="rounded bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:bg-primary/30"
            >
              Preview Import
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="rounded border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-4">
              <h3 className="text-lg font-medium text-foreground">Preview</h3>
              <span className="rounded bg-success/10 px-2 py-1 text-xs text-success">New: {preview.newCount}</span>
              <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">Update: {preview.updateCount}</span>
              <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">Skipped: {preview.skipCount}</span>
              <span className="rounded bg-warning/10 px-2 py-1 text-xs text-warning">Warnings: {preview.warningCount}</span>
              <span className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">Errors: {preview.errorCount}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview.errorCount > 0
                ? "Rows with an error are omitted. Everything else is imported — values that could not be read are saved as \"not available\"."
                : `Ready to import ${preview.newCount + preview.updateCount} rows. Missing or unreadable values are saved as "not available"; new brands are created automatically.`}
            </p>
          </div>

          {preview.errorRows.length > 0 && (
            <div className="rounded border border-destructive/20 bg-destructive/5 p-4">
              <h4 className="mb-2 text-sm font-medium text-destructive">Rows that cannot be imported ({preview.errorRows.length})</h4>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-destructive/90">
                {preview.errorRows.slice(0, 200).map((row, index) => (
                  <li key={index}>
                    Row {row.rowIndex}: {row.message}
                  </li>
                ))}
                {preview.errorRows.length > 200 && (
                  <li className="text-muted-foreground">...and {preview.errorRows.length - 200} more.</li>
                )}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto rounded border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  {previewPreviewFields.map((field) => (
                    <th key={field} className="px-3 py-2 font-medium">
                      {previewFieldLabel(field)}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const status = row.errors.length > 0 ? "error" : row.existingProductId ? (mode === "update" ? "update" : "skipped") : row.warnings.length > 0 ? "warning" : "new";
                  return (
                    <tr key={row.rowIndex} className="border-b border-border/50 align-top">
                      <td className="px-3 py-2 text-muted-foreground">{row.rowIndex}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            status === "error"
                              ? "bg-destructive/10 text-destructive"
                              : status === "skipped"
                                ? "bg-muted text-muted-foreground"
                                : status === "update"
                                  ? "bg-primary/10 text-primary"
                                  : status === "warning"
                                    ? "bg-warning/10 text-warning"
                                    : "bg-success/10 text-success"
                          }`}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      {previewPreviewFields.map((field) => (
                        <td key={field} className="px-3 py-2">
                          {row.values[field] || <span className="text-muted-foreground">-</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-xs">
                        {row.errors.length > 0 ? (
                          <span className="text-destructive">{row.errors.join(" ")}</span>
                        ) : row.warnings.length > 0 ? (
                          <span className="text-warning">{row.warnings.join(" ")}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {preview.rows.length > MAX_PREVIEW_ROWS && (
                  <tr>
                    <td colSpan={previewPreviewFields.length + 3} className="px-3 py-2 text-sm text-muted-foreground">
                      ...and {preview.rows.length - MAX_PREVIEW_ROWS} more rows (not shown).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-3">
                        <button
              type="button"
              onClick={runImport}
              disabled={importing || preview.newCount + preview.updateCount === 0}
              className="rounded bg-success px-4 py-2 text-white hover:bg-success/90 disabled:cursor-not-allowed disabled:bg-success/30"
            >
              {importing
                ? "Importing..."
                : `Import ${preview.newCount + preview.updateCount} rows`}
            </button>
            <button
              type="button"
              onClick={() => setStep("mapping")}
              disabled={importing}
              className="rounded border border-border px-4 py-2 text-foreground/80 hover:bg-muted/30"
            >
              Back to Mapping
            </button>
            <button
              type="button"
              onClick={resetFile}
              disabled={importing}
              className="rounded border border-border px-4 py-2 text-foreground/80 hover:bg-muted/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "done" && importResult && (
        <div className="rounded border border-border bg-card p-4">
          <h3 className="mb-3 text-lg font-medium text-foreground">Import Complete</h3>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="rounded bg-success/10 px-2 py-1 text-success">Created: {importResult.created}</span>
            <span className="rounded bg-primary/10 px-2 py-1 text-primary">Updated: {importResult.updated}</span>
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">Skipped: {importResult.skipped}</span>
            <span className="rounded bg-destructive/10 px-2 py-1 text-destructive">Failed: {importResult.failed}</span>
          </div>
          {importResult.failures.length > 0 && (
            <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto text-sm text-destructive">
              {importResult.failures.map((failure, index) => (
                <li key={index}>
                  {failure.rowLabel}: {failure.message}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={resetFile}
            className="mt-4 rounded bg-primary px-4 py-2 text-white hover:bg-primary/90"
          >
            Import Another File
          </button>
        </div>
      )}
    </div>
  );
}
