import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { recognizeSpreadsheetReference } from "../src/lib/print/spreadsheet-reference";
import { recognizeDocument } from "../src/lib/print/recognize-document";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";

async function main() {
  const xml = recognizeSpreadsheetReference(readFileSync("e2e/fixtures/reference-invoice.xml"), "sales_invoice");
  assert.deepEqual(xml.template.columns.labels.map(c => c.key), ["product", "quantity", "price"]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Cover page"]]), "Cover");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Load form"], ["Item Name", "Qty", "Bns", "SKU"], ["Fixture Medicine ABC123", 10, 2, "secret-example"]]), "Load");
  const loaded = recognizeSpreadsheetReference(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "load_form");
  assert.deepEqual(loaded.template.columns.labels.map(c => c.key), ["product", "quantity", "bonus"]);
  assert(loaded.warnings.some(warning => warning.includes("SKU")));
  assert(!JSON.stringify(loaded).includes("Fixture Medicine ABC123"));
  const blank = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(blank, XLSX.utils.aoa_to_sheet([["Nothing recognizable"]]), "Sheet");
  assert.throws(() => recognizeSpreadsheetReference(XLSX.write(blank, { type: "buffer", bookType: "xlsx" }), "sales_invoice"), /Could not identify/);
  const calls: { url: string; body: any }[] = [];
  const response = (finishReason = "STOP", text = JSON.stringify(cloneDefaultTemplate("sales_invoice"))) => Response.json({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
  const mock = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return calls.length === 1 ? new Response("", { status: 503 }) : response(); }) as typeof fetch;
  const env = { GEMINI_API_KEY: "test-only-key", GEMINI_PRIMARY_MODEL: "primary", GEMINI_FALLBACK_MODEL: "fallback" };
  const result = await recognizeDocument(Buffer.from("synthetic"), "application/pdf", "sales_invoice", env, mock);
  assert.equal(result.model, "fallback"); assert.equal(calls.length, 2);
  assert.equal(calls[1].body.contents[0].parts[0].inlineData.mimeType, "application/pdf");
  assert.equal(calls[1].body.systemInstruction.parts.length, 1);
  await assert.rejects(recognizeDocument(Buffer.from("test"), "image/png", "sales_invoice", env, (async () => response("MAX_TOKENS")) as typeof fetch), /did not finish/);
  await assert.rejects(recognizeDocument(Buffer.from("test"), "image/png", "sales_invoice", env, (async () => response("STOP", "{}")) as typeof fetch), /No supported/);
  await assert.rejects(recognizeDocument(Buffer.from("test"), "image/png", "sales_invoice", env, (async () => response("STOP", JSON.stringify({ columns: { labels: [{ key: "price" }] } }))) as typeof fetch), /No supported/);
  await assert.rejects(recognizeDocument(Buffer.from("test"), "image/png", "sales_invoice", {}, mock), /not configured/);
  console.log("Reference recognition regressions passed: XML, multiple worksheets, unsupported columns, no sample-data copying, provider fallback, PDF payload, incomplete/empty result rejection.");
  if (process.env.TRADEOS_REFERENCE_TEST_FILE) {
    const { loadEnvConfig } = await import("@next/env"); loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
    const path = process.env.TRADEOS_REFERENCE_TEST_FILE;
    const live = await recognizeDocument(readFileSync(path), path.endsWith(".pdf") ? "application/pdf" : "image/png", "sales_invoice");
    assert(live.template.columns.labels.some(column => column.key === "product"));
    assert(live.template.columns.labels.some(column => column.key === "quantity"));
    console.log(JSON.stringify({ liveProvider: live.recognitionMethod, model: live.model, columns: live.template.columns.labels, heading: live.template.header.headingText }));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Reference test failed"); process.exitCode = 1; });
