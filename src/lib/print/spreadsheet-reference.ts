import * as XLSX from "xlsx";
import { cloneDefaultTemplate } from "./default-templates";
import { reviewReferenceTemplate } from "./reference-template";
import type { PrintDocumentType } from "./print-template-types";

const aliases: Record<string, string[]> = {
  product: ["product", "product name", "item", "item name", "description", "medicine", "medicine name", "item description", "particulars"],
  quantity: ["quantity", "qty", "qty sold", "sale qty", "pieces", "pcs", "units", "cartons", "boxes"],
  price: ["price", "rate", "unit price", "unit rate", "selling price"],
  discount: ["discount", "disc", "discount amount"],
  total: ["total", "amount", "line total", "net amount", "net value", "value"],
  bonus: ["bonus", "bns", "free", "free qty", "bonus qty"],
};
const normalize = (value: unknown) => String(value ?? "").toLowerCase().replace(/[._:]/g, " ").replace(/\s+/g, " ").trim();

/** Recognize table structure locally. Never send workbook customer/product data to AI. */
export function recognizeSpreadsheetReference(buffer: Buffer, docType: PrintDocumentType) {
  const book = XLSX.read(buffer, { type: "buffer", cellStyles: true, sheetRows: 80 });
  const proposed = cloneDefaultTemplate(docType);
  const supported = new Set(proposed.columns.labels.map(column => column.key));
  let best: { sheet: XLSX.WorkSheet; name: string; row: number; cells: { column: number; label: string; key: string }[]; score: number } | undefined;
  for (const name of book.SheetNames.slice(0, 10)) {
    const sheet = book.Sheets[name];
    if (!sheet["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 49); row++) {
      const cells = [];
      for (let column = range.s.c; column <= Math.min(range.e.c, range.s.c + 63); column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (!cell || cell.v === null || cell.v === undefined || String(cell.v).trim() === "") continue;
        const label = String(cell.v).trim().slice(0, 80);
        const key = Object.keys(aliases).find(key => aliases[key].includes(normalize(label))) ?? "unknown";
        cells.push({ column, label, key: supported.has(key) ? key : "unknown" });
      }
      const keys = new Set(cells.filter(cell => cell.key !== "unknown").map(cell => cell.key));
      if (!keys.has("product") || keys.size < 2) continue;
      const score = keys.size * 100 - cells.filter(cell => cell.key === "unknown").length;
      if (!best || score > best.score) best = { sheet, name, row, cells, score };
    }
  }
  if (!best) throw new Error("Could not identify a product table. Include a Product/Item heading and Quantity, Rate, Amount or Bonus heading in the first 50 rows, or customize manually.");
  const chosen = best;
  let widthsFound = true;
  proposed.columns.labels = chosen.cells.map(cell => {
    const dimensions = chosen.sheet["!cols"]?.[cell.column];
    const width = dimensions?.wpx ?? dimensions?.wch ?? dimensions?.width;
    if (!width || !Number.isFinite(width)) widthsFound = false;
    return { key: cell.key, label: cell.label, widthPct: Number(width) > 0 ? Number(width) : 10 };
  });
  const widthTotal = proposed.columns.labels.reduce((sum, cell) => sum + cell.widthPct, 0);
  proposed.columns.labels.forEach(cell => { cell.widthPct = cell.widthPct / widthTotal * 100; });
  // SheetJS does not expose font styles consistently across all supported formats.
  // Keep defaults and explicitly ask for review instead of pretending to copy them.
  const result = reviewReferenceTemplate(docType, proposed);
  result.warnings.unshift(`Detected table on worksheet "${chosen.name}", row ${chosen.row + 1}. Confirm that each column has the intended meaning.`, "Fonts, spacing and header/footer visibility use editable defaults; compare them with your reference.");
  if (!widthsFound) result.warnings.unshift("Some column widths were unavailable; estimated widths are shown.");
  return { ...result, recognitionMethod: "spreadsheet" as const };
}
