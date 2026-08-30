import type { ColumnMapping, ImportFieldDef } from "./types";

export const DEFAULT_MAX_IMPORT_ROWS = 5000;
export const PRESERVE_IN_NOTES = "__preserve_in_notes__";

const ALIASES: Record<string, string[]> = {
  invoice_number: ["invoice", "invoice no", "invoice num", "invoice number", "invoice #", "inv no", "inv number", "bill number", "document number"],
  supplier_invoice_number: ["supplier invoice", "supplier invoice no", "supplier invoice number", "vendor invoice", "vendor invoice number"],
  customer: ["customer", "customer name", "client", "client name", "buyer", "buyer name", "party", "party name", "account name"],
  customer_name: ["name", "customer", "customer name", "client", "client name", "buyer", "buyer name", "party", "party name"],
  supplier: ["supplier", "supplier name", "vendor", "vendor name", "client", "client name", "party", "party name", "account name"],
  name: ["name", "product", "product name", "item", "item name"],
  sale_date: ["date", "sale date", "invoice date", "transaction date", "created date", "created on"],
  purchase_date: ["date", "purchase date", "invoice date", "bill date", "transaction date", "created date", "created on"],
  payment_date: ["date", "payment date", "receipt date", "transaction date", "created date", "created on"],
  reference_number: ["reference", "reference no", "reference number", "reference #", "ref", "ref no", "ref number", "cheque no", "cheque number", "check no", "check number"],
  payment_method: ["method", "payment method", "mode", "payment mode"],
  payment_type: ["payment type", "sale type", "credit or cash", "cash or credit"],
  amount: ["amount", "payment amount", "paid amount", "received amount"],
  total_amount: ["total", "total amount", "invoice total", "grand total", "net total"],
  notes: ["notes", "note", "description", "remarks", "remark", "memo"],
  created_by: ["created by", "recorded by", "entered by", "employee", "staff"],
  salesman: ["salesman", "sales person", "salesperson", "sales rep", "sales representative", "employee"],
  line_product: ["name", "product", "product name", "item", "item name", "line product"],
  line_quantity: ["quantity", "qty", "line quantity"],
  line_price: ["unit price", "selling price", "price", "rate"],
};

export function normalizeImportHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[_\-./\\#()]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreHeader(header: string, field: ImportFieldDef): number {
  const normalized = normalizeImportHeader(header);
  if (!normalized) return 0;

  const key = normalizeImportHeader(field.key);
  const label = normalizeImportHeader(field.label);
  if (normalized === key || normalized === label) return 100;
  if ((ALIASES[field.key] ?? []).includes(normalized)) return 90;

  // Conservative fallback for descriptive headers such as "Customer Name (required)".
  // Generic words are excluded because mapping "Date" or "Name" fuzzily is unsafe.
  if (normalized.length >= 5 && label.length >= 5 && (normalized.includes(label) || label.includes(normalized))) {
    return 50;
  }
  return 0;
}

export function getUnmappedTargetField(fields: ImportFieldDef[]): string | null {
  if (fields.some((field) => field.key === "notes")) return "notes";
  if (fields.some((field) => field.key === "description")) return "description";
  return null;
}

/**
 * Deterministically suggest one source column per TradeOS field. Unknown columns
 * are retained in Notes/Description when that entity supports it.
 */
export function guessColumnMapping(headers: string[], fields: ImportFieldDef[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const candidates: Array<{ header: string; key: string; score: number; headerIndex: number }> = [];

  headers.forEach((header, headerIndex) => {
    fields.forEach((field) => {
      const score = scoreHeader(header, field);
      if (score > 0) candidates.push({ header, key: field.key, score, headerIndex });
    });
  });

  const claimedHeaders = new Set<string>();
  const claimedFields = new Set<string>();
  candidates
    .sort((a, b) => b.score - a.score || a.headerIndex - b.headerIndex)
    .forEach((candidate) => {
      if (claimedHeaders.has(candidate.header) || claimedFields.has(candidate.key)) return;
      mapping[candidate.header] = candidate.key;
      claimedHeaders.add(candidate.header);
      claimedFields.add(candidate.key);
    });

  const preserveUnknown = Boolean(getUnmappedTargetField(fields));
  for (const header of headers) {
    if (!mapping[header]) mapping[header] = preserveUnknown ? PRESERVE_IN_NOTES : "skip";
  }
  return mapping;
}

/** Apply a saved mapping to the current file without losing newly seen columns. */
export function reconcileColumnMapping(
  headers: string[],
  saved: ColumnMapping | null | undefined,
  fields: ImportFieldDef[],
): ColumnMapping {
  const guessed = guessColumnMapping(headers, fields);
  if (!saved) return guessed;

  const allowedTargets = new Set([...fields.map((field) => field.key), "skip", PRESERVE_IN_NOTES]);
  const savedByNormalizedHeader = new Map(
    Object.entries(saved).map(([header, target]) => [normalizeImportHeader(header), target]),
  );

  for (const header of headers) {
    const savedTarget = saved[header] ?? savedByNormalizedHeader.get(normalizeImportHeader(header));
    if (savedTarget && allowedTargets.has(savedTarget)) guessed[header] = savedTarget;
  }
  return guessed;
}

export function appendPreservedImportData(
  values: Record<string, unknown>,
  raw: Record<string, string>,
  mapping: ColumnMapping,
  fields: ImportFieldDef[],
): void {
  const target = getUnmappedTargetField(fields);
  if (!target) return;

  const pairs = Object.entries(mapping)
    .filter(([, mappedTo]) => mappedTo === PRESERVE_IN_NOTES)
    .map(([header]) => [header.trim(), String(raw[header] ?? "").replace(/\s+/g, " ").trim()] as const)
    .filter(([header, value]) => header && value)
    .slice(0, 25);
  if (pairs.length === 0) return;

  const imported = pairs.map(([header, value]) => `${header}: ${value.slice(0, 300)}`).join(" | ");
  const existing = values[target] == null ? "" : String(values[target]).trim();
  values[target] = [existing, `Imported fields — ${imported}`].filter(Boolean).join("\n").slice(0, 4000);
}
