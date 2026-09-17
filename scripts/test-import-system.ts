import assert from "node:assert/strict";
import { importedInitialStock } from "../src/lib/import-wizard/initial-stock";
import { assignImportColumn, validateImportRows } from "../src/lib/import-wizard/validation";
import { saveImportedInitialStock } from "../src/lib/import-wizard/save-initial-stock";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product } from "../src/lib/tradeos/types";
import { salesInvoicesImportConfig } from "../src/lib/import-export/entities/sales-invoices";
import { customerPaymentsImportConfig } from "../src/lib/import-export/entities/customer-payments";
import { supplierPaymentsImportConfig } from "../src/lib/import-export/entities/supplier-payments";
import { productsImportConfig } from "../src/lib/import-export/entities/products";
import {
  PRESERVE_IN_NOTES,
  appendPreservedImportData,
  guessColumnMapping,
  reconcileColumnMapping,
} from "../src/lib/import-export/mapping";
import { importErrorMessage, parseCellValue } from "../src/lib/import-export/processor";
import { runImport } from "../src/lib/import-export/processor";
import type { EntityImportConfig, ImportContext, ImportPreviewResult, ParsedRow } from "../src/lib/import-export/types";

async function main() {
  assert.equal(
    importErrorMessage({ message: "Column supplier_code does not exist", details: "schema cache is stale", hint: "Run the migration", code: "PGRST204" }),
    "Column supplier_code does not exist — schema cache is stale — Run the migration — Code: PGRST204",
  );
  assert.equal(importErrorMessage({ code: "PGRST204" }), "Could not import this row.");
  const corrected = assignImportColumn({ Product: "name", Cotton: "skip", Stock: "initial_stock" }, "Cotton", "initial_stock");
  assert.equal(corrected.Stock, "skip");
  const cottonPreview = validateImportRows({ fileColumns: ["Product", "Cotton", "Stock"], mapping: corrected,
    rows: [["Warehouse Product", "35", ""]], mode: "skip", categories: [], brands: [], products: [] });
  assert.equal(cottonPreview.errorCount, 0);
  assert.equal(importedInitialStock(cottonPreview.rows[0].values), 35, "Blank later column cannot erase explicitly selected Cotton stock");
  const conflictPreview = validateImportRows({ fileColumns: ["Product", "Cotton", "Stock"],
    mapping: { Product: "name", Cotton: "initial_stock", Stock: "initial_stock" },
    rows: [["Warehouse Product", "35", ""]], mode: "skip", categories: [], brands: [], products: [] });
  assert.ok(conflictPreview.errorCount > 0, "Conflicting saved mappings must not silently save zero stock");
  const existingUuid = "ee028d74-6963-4181-8c77-55f41dc979dd";
  const existingPreview = validateImportRows({ fileColumns: ["Product", "Cotton"],
    mapping: { Product: "name", Cotton: "initial_stock" }, rows: [["Warehouse Product", "35"]], mode: "skip",
    categories: [], brands: [], products: [{ id: existingUuid, name: "Warehouse Product", sku: null } as Product] });
  assert.equal(existingPreview.rows[0].existingProductId, existingUuid, "UUIDs must survive duplicate matching without conversion to NaN");
  assert.equal(existingPreview.skipCount, 1);
  let stockArgs: Record<string, unknown> = {};
  const stockClient = { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, "adjust_inventory"); stockArgs = args; return { data: "ledger-id", error: null };
  }} as unknown as SupabaseClient;
  await saveImportedInitialStock(stockClient, "org", "product", importedInitialStock(cottonPreview.rows[0].values), "actor");
  assert.equal(stockArgs.p_quantity_delta, 35);
  assert.equal(stockArgs.p_product_id, "product");
  const deniedClient = { rpc: async () => ({ data: null, error: { message: "Permission denied" } }) } as unknown as SupabaseClient;
  await assert.rejects(saveImportedInitialStock(deniedClient, "org", "product", 35, "actor"), /Permission denied/);
  const emptyClient = { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
  await assert.rejects(saveImportedInitialStock(emptyClient, "org", "product", 35, "actor"), /no inventory record/);
  await assert.rejects(saveImportedInitialStock(stockClient, "org", "product", 35, null), /Sign in again/);
  const stockPreview = validateImportRows({
    fileColumns: ["External Name", "Cotton", "Packing"],
    mapping: { "External Name": "name", Cotton: "initial_stock_subunit", Packing: "units_per_pack" },
    rows: [["Test Product", "120", "12"]], mode: "skip", categories: [], brands: [], products: [],
  });
  assert.equal(stockPreview.errorCount, 0);
  assert.equal(importedInitialStock(stockPreview.rows[0].values), 10, "Selected pieces mapping overrides a Cotton header");
  assert.equal(importedInitialStock({ initial_stock: "120", units_per_pack: "12" }), 120, "Main-unit quantities are not converted");
  assert.equal(importedInitialStock({ initial_stock: "2", initial_stock_subunit: "6", units_per_pack: "12" }), 2.5);
  assert.equal(importedInitialStock({ initial_stock_subunit: "1,200", units_per_pack: "12" }), 100);
  assert.throws(() => importedInitialStock({ initial_stock_subunit: "120" }), /Units Per Pack/);
  assert.throws(() => importedInitialStock({ initial_stock: "bad" }), /valid non-negative/);
  assert.throws(() => importedInitialStock({ initial_stock_subunit: "-1", units_per_pack: 12 }), /valid non-negative/);
  const invalidStockPreview = validateImportRows({
    fileColumns: ["Product", "Stock"], mapping: { Product: "name", Stock: "initial_stock_subunit" },
    rows: [["Test Product", "120"]], mode: "skip", categories: [], brands: [], products: [],
  });
  assert.ok(invalidStockPreview.errorCount > 0, "Missing pack size is blocked before writes");
  const invoiceHeaders = ["Invoice Number", "Organization Number", "Client", "Name", "Reference", "Created Date"];
  const invoiceMapping = guessColumnMapping(invoiceHeaders, salesInvoicesImportConfig.fields);
  assert.equal(invoiceMapping["Invoice Number"], "invoice_number");
  assert.equal(invoiceMapping.Client, "customer");
  assert.equal(invoiceMapping["Created Date"], "sale_date");
  assert.equal(invoiceMapping["Organization Number"], PRESERVE_IN_NOTES);
  assert.equal(invoiceMapping.Reference, PRESERVE_IN_NOTES);
  assert.equal(invoiceMapping.Name, "line_product");

  const customerPaymentMapping = guessColumnMapping(
    ["Client", "Paid Amount", "Created Date", "Payment Mode", "Reference"],
    customerPaymentsImportConfig.fields,
  );
  assert.deepEqual(customerPaymentMapping, {
    Client: "customer",
    "Paid Amount": "amount",
    "Created Date": "payment_date",
    "Payment Mode": "payment_method",
    Reference: "reference_number",
  });

  const supplierPaymentMapping = guessColumnMapping(
    ["Client", "Amount", "Date", "Method"],
    supplierPaymentsImportConfig.fields,
  );
  assert.equal(supplierPaymentMapping.Client, "supplier");
  assert.equal(supplierPaymentMapping.Date, "payment_date");

  const productMapping = guessColumnMapping(["Name", "SKU", "External Custom Field"], productsImportConfig.fields);
  assert.equal(productMapping.Name, "name");
  assert.equal(productMapping.SKU, "sku");
  assert.equal(productMapping["External Custom Field"], "skip");

  const reconciled = reconcileColumnMapping(
    ["CLIENT", "Amount", "Payment Date"],
    { Client: "customer", Amount: "amount" },
    customerPaymentsImportConfig.fields,
  );
  assert.equal(reconciled.CLIENT, "customer");
  assert.equal(reconciled["Payment Date"], "payment_date");

  const values: Record<string, unknown> = { notes: "Existing note" };
  appendPreservedImportData(
    values,
    { "Organization Number": "ORG-42", Comment: "External memo" },
    { "Organization Number": PRESERVE_IN_NOTES, Comment: PRESERVE_IN_NOTES },
    customerPaymentsImportConfig.fields,
  );
  assert.equal(values.notes, "Existing note\nImported fields — Organization Number: ORG-42 | Comment: External memo");

  const integer = await parseCellValue(
    "1.5",
    { key: "count", label: "Count", type: "integer" },
    {},
    {} as never,
  );
  assert.equal(integer, null);

  const batchSizes: number[] = [];
  const batchConfig: EntityImportConfig = {
    entityKey: "batch_test",
    entityName: "Batch Test",
    tableName: "batch_test",
    existingColumns: "id, name",
    fields: [{ key: "name", label: "Name", type: "text", required: true }],
    uniqueKeys: [],
    defaultDuplicateMode: "error",
    insertBatchSize: 500,
    async buildUpsertPayload(row) {
      return { name: row.values.name };
    },
  };
  const rows: ParsedRow[] = Array.from({ length: 1201 }, (_, index) => ({
    rowIndex: index + 2,
    raw: { Name: `Row ${index}` },
    values: { name: `Row ${index}` },
    errors: [],
    warnings: [],
    status: "new",
  }));
  const preview: ImportPreviewResult = {
    fileColumns: ["Name"],
    rows,
    stats: { totalRows: rows.length, newCount: rows.length, updateCount: 0, skipCount: 0, errorCount: 0, warningCount: 0 },
    errorRows: [],
  };
  const fakeSupabase = {
    from() {
      return {
        insert(payload: unknown[]) {
          batchSizes.push(payload.length);
          return {
            async select() {
              return { data: payload.map((_, index) => ({ id: index + 1 })), error: null };
            },
          };
        },
      };
    },
  };
  const batchResult = await runImport(batchConfig, preview, {
    orgId: "org-test",
    supabase: fakeSupabase as never,
    duplicateMode: "error",
    fileName: "batch.csv",
    fileHeaders: ["Name"],
    mapping: { Name: "name" },
    existingCache: new Map(),
    refCaches: new Map(),
    stats: preview.stats,
  } as ImportContext);
  assert.equal(batchResult.created, 1201);
  assert.deepEqual(batchSizes, [500, 500, 201]);

  console.log("Import mapping, preservation, and parsing tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
