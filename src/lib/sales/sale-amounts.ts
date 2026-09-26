export type SaleAmountLine = {
  quantity: number;
  sellingPrice: number;
  discount?: number;
};

export type SaleAmountOptions = {
  invoiceDiscount?: number;
  invoiceDiscountType?: "flat" | "percent";
  taxRate?: number;
};

export type SaleAmounts = {
  lineSubtotal: number;
  lineDiscount: number;
  subtotal: number;
  invoiceDiscount: number;
  taxableAmount: number;
  tax: number;
  total: number;
};

export const SALE_QUANTITY_DECIMAL_PLACES = 3;
export const SALE_MONEY_DECIMAL_PLACES = 2;

export function hasAllowedPrecision(value: string | number, decimalPlaces: number): boolean {
  const raw = String(value).trim();
  const match = /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))$/.exec(raw);
  if (!match) return false;
  const fraction = match[1] ?? match[2] ?? "";
  return fraction.length <= decimalPlaces || /^0*$/.test(fraction.slice(decimalPlaces));
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateSaleLineTotal(line: SaleAmountLine): number {
  const gross = roundMoney(line.quantity * line.sellingPrice);
  return roundMoney(gross - roundMoney(line.discount ?? 0));
}

export function calculateSaleAmounts(
  lines: SaleAmountLine[],
  options: SaleAmountOptions = {},
): SaleAmounts {
  const normalizedLines = lines.map((line) => ({
    gross: roundMoney(line.quantity * line.sellingPrice),
    discount: roundMoney(line.discount ?? 0),
  }));
  const lineSubtotal = roundMoney(normalizedLines.reduce((sum, line) => sum + line.gross, 0));
  const lineDiscount = roundMoney(normalizedLines.reduce((sum, line) => sum + line.discount, 0));
  const subtotal = roundMoney(normalizedLines.reduce((sum, line) => sum + line.gross - line.discount, 0));
  const rawInvoiceDiscount = Number.isFinite(options.invoiceDiscount) ? options.invoiceDiscount ?? 0 : 0;
  const invoiceDiscount = roundMoney(
    options.invoiceDiscountType === "percent"
      ? subtotal * rawInvoiceDiscount / 100
      : rawInvoiceDiscount,
  );
  const taxableAmount = roundMoney(Math.max(0, subtotal - invoiceDiscount));
  const taxRate = Number.isFinite(options.taxRate) ? options.taxRate ?? 0 : 0;
  const tax = roundMoney(taxableAmount * taxRate / 100);
  const total = roundMoney(taxableAmount + tax);

  return { lineSubtotal, lineDiscount, subtotal, invoiceDiscount, taxableAmount, tax, total };
}
