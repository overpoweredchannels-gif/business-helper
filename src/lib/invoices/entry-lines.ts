/** Ignore only untouched placeholder rows; partially entered rows still need validation. */
export function enteredInvoiceLines<T extends { product_id: string | null }>(lines: T[]): T[] {
  return lines.filter(line => Object.entries(line).some(([key, value]) =>
    key !== "unit_mode" && value !== null && value !== undefined && String(value).trim() !== ""));
}
