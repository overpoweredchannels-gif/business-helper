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

export function buildHistoricalSummary(row: HistoricalSummaryRow, keyword = "") {
  const recordLabel = row.kind === "sale" ? "sale" : row.kind === "purchase" ? "purchase" : row.kind === "customer_payment" ? "customer payment" : row.kind === "supplier_payment" ? "supplier payment" : row.kind;
  const products = (row.payload?.lines ?? [])
    .map((line) => line.product_name)
    .filter((value): value is string => Boolean(value && value.trim()));
  const topProducts = products.length ? products.slice(0, 2).join(" + ") : "no product details";
  const paymentNote = row.payload?.related_invoice ? ` linked to ${row.payload.related_invoice}` : "";
  const keywordText = keyword.trim();
  const keywordMatch = keywordText ? ` Keyword match: “${keywordText}”.` : "";
  return `${row.party_name} ${recordLabel} ${row.record_number} on ${row.record_date}. Total ${formatMoney(row.total_amount)} from ${row.source_system} via ${row.source_file}. Most relevant items: ${topProducts}.${paymentNote}${keywordMatch}`.trim();
}
