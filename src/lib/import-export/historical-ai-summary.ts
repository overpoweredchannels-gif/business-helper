// Language note: this module has no React hook, so the summary template
// reads its lines straight from the message tables via the caller's
// `language` (same pattern as the staff-invite template). The money format
// stays en-PK/PKR by design: these are pre-cutover historical records.
import { messages } from "@/lib/regional/messages";
import type { Language } from "@/lib/regional/settings";

type HistoricalSummaryRow = {
  kind: string;
  record_number: string;
  party_name: string;
  record_date: string;
  total_amount: number;
  source_system: string;
  source_file: string;
  payload?: {
    related_invoice?: string | null;
    lines?: Array<{
      product_name?: string | null;
      quantity?: number | null;
      unit_mode?: string | null;
      unit_price?: number | null;
      bonus?: number | null;
      discount?: number | null;
      source_row?: number | null;
    }>;
  };
};

const formatMoney = (amount: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(amount);

export function buildHistoricalSummary(row: HistoricalSummaryRow, keyword = "", language: Language = "en") {
  const m = messages[language];
  const recordLabel = row.kind === "sale" ? m['hist.kindSaleLower'] : row.kind === "purchase" ? m['hist.kindPurchaseLower'] : row.kind === "customer_payment" ? m['hist.kindCustomerPaymentLower'] : row.kind === "supplier_payment" ? m['hist.kindSupplierPaymentLower'] : row.kind;
  const products = (row.payload?.lines ?? [])
    .map((line) => line.product_name)
    .filter((value): value is string => Boolean(value && value.trim()));
  const topProducts = products.length ? products.slice(0, 2).join(" + ") : m['hist.noProductDetails'];
  const paymentNote = row.payload?.related_invoice ? ` ${m['hist.linkedTo'].replace('{invoice}', row.payload.related_invoice)}` : "";
  const keywordText = keyword.trim();
  const keywordMatch = keywordText ? ` ${m['hist.keywordMatch'].replace('{keyword}', keywordText)}` : "";
  return m['hist.summaryTemplate']
    .replace('{party}', row.party_name)
    .replace('{kind}', recordLabel)
    .replace('{number}', row.record_number)
    .replace('{date}', row.record_date)
    .replace('{total}', formatMoney(row.total_amount))
    .replace('{system}', row.source_system)
    .replace('{file}', row.source_file)
    .replace('{items}', topProducts)
    .replace('{linked}', paymentNote)
    .replace('{keyword}', keywordMatch)
    .trim();
}
