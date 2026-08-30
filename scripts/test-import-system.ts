import assert from "node:assert/strict";
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
import { parseCellValue } from "../src/lib/import-export/processor";
import { runImport } from "../src/lib/import-export/processor";
import type { EntityImportConfig, ImportContext, ImportPreviewResult, ParsedRow } from "../src/lib/import-export/types";

async function main() {
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
