import { buildRetailDrawerSummary, type RetailDrawerSummary } from "./retail-summary";
import {
  calculateSaleAmounts,
  calculateSaleLineTotal,
  hasAllowedPrecision,
  SALE_MONEY_DECIMAL_PLACES,
  SALE_QUANTITY_DECIMAL_PLACES,
  type SaleAmounts,
} from "./sale-amounts";

export type SaleDraftLine = {
  product_id?: string | null;
  quantity: string;
  selling_price: string;
  discount?: string;
  bonus?: string;
};

export type SaleDraftIssue = {
  field: "product_id" | "quantity" | "selling_price" | "discount" | "bonus" | "invoice_discount" | "tax" | "cash_received" | "sale";
  lineIndex?: number;
  message: string;
};

export type SaleDraftResult = {
  valid: boolean;
  issues: SaleDraftIssue[];
  amounts?: SaleAmounts;
  lineTotals: Array<number | null>;
  cashSummary?: RetailDrawerSummary;
};

type SaleDraftInput = {
  lines: SaleDraftLine[];
  invoiceDiscount: string;
  invoiceDiscountType: "flat" | "percent";
  taxRate: string;
  paymentType?: "cash" | "credit";
  cashReceived?: string;
  validateCash?: boolean;
  allowInvoiceAdjustments?: boolean;
};

const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const supportedTextLength = 80;

function isDraftDecimal(value: string): boolean {
  return value.length <= supportedTextLength && decimalPattern.test(value.trim());
}

function isSupportedNonNegative(value: string, places: number): boolean {
  const trimmed = value.trim();
  return isDraftDecimal(trimmed) && hasAllowedPrecision(trimmed, places) && Number(trimmed) >= 0;
}

function issueFromCalculationError(message: string): SaleDraftIssue {
  if (/invoice discount/i.test(message)) {
    return { field: "invoice_discount", message: "Invoice discount must be valid, within its allowed range, and no greater than the subtotal." };
  }
  if (message.includes("Tax rate")) {
    return { field: "tax", message: "Tax rate must be between 0 and 999.99 with up to two decimal places." };
  }
  return { field: "sale", message: "This sale is outside the supported calculation range. Adjust the entered values." };
}

/**
 * Validates editable strings without rewriting them. Strict amount helpers are
 * only called after each field is supported; any strict failure becomes an
 * inline issue so typing and restored held sales never throw during render.
 */
export function validateSaleDraft(input: SaleDraftInput): SaleDraftResult {
  const issues: SaleDraftIssue[] = [];
  const lineTotals: Array<number | null> = input.lines.map(() => null);
  const lineFieldsValid = input.lines.map((line, lineIndex) => {
    let valid = true;
    if (line.product_id !== undefined && !line.product_id) {
      issues.push({ field: "product_id", lineIndex, message: "Choose a product for this line." });
      valid = false;
    }

    const quantity = line.quantity.trim();
    if (!quantity) {
      issues.push({ field: "quantity", lineIndex, message: "Enter a quantity greater than zero." });
      valid = false;
    } else if (!isSupportedNonNegative(quantity, SALE_QUANTITY_DECIMAL_PLACES) || Number(quantity) <= 0) {
      issues.push({ field: "quantity", lineIndex, message: "Quantity must be positive and use up to three decimal places." });
      valid = false;
    }

    const price = line.selling_price.trim();
    if (!price) {
      issues.push({ field: "selling_price", lineIndex, message: "Enter a selling price." });
      valid = false;
    } else if (!isSupportedNonNegative(price, SALE_MONEY_DECIMAL_PLACES)) {
      issues.push({ field: "selling_price", lineIndex, message: "Price must be non-negative and use up to two decimal places." });
      valid = false;
    }

    const discount = (line.discount ?? "").trim();
    if (discount && !isSupportedNonNegative(discount, SALE_MONEY_DECIMAL_PLACES)) {
      issues.push({ field: "discount", lineIndex, message: "Line discount must be non-negative and use up to two decimal places." });
      valid = false;
    }

    const bonus = (line.bonus ?? "").trim();
    if (bonus && !isSupportedNonNegative(bonus, SALE_QUANTITY_DECIMAL_PLACES)) {
      issues.push({ field: "bonus", lineIndex, message: "Bonus quantity must be non-negative and use up to three decimal places." });
      valid = false;
    }

    if (!valid) return false;
    try {
      lineTotals[lineIndex] = calculateSaleLineTotal({
        quantity,
        sellingPrice: price,
        discount: discount || "0",
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid sale line.";
      const field = message.includes("discount") ? "discount" : message.includes("Quantity") ? "quantity" : "selling_price";
      const fieldMessage = field === "discount"
        ? "Line discount cannot exceed the line subtotal."
        : field === "quantity"
          ? "Quantity is outside the supported range."
          : "Price or line total is outside the supported range.";
      issues.push({ field, lineIndex, message: fieldMessage });
      return false;
    }
  });

  const invoiceDiscount = input.invoiceDiscount.trim();
  const taxRate = input.taxRate.trim();
  let totalsFieldsValid = true;
  if (invoiceDiscount && !isSupportedNonNegative(invoiceDiscount, SALE_MONEY_DECIMAL_PLACES)) {
    issues.push({ field: "invoice_discount", message: "Invoice discount must be non-negative and use up to two decimal places." });
    totalsFieldsValid = false;
  }
  if (input.invoiceDiscountType === "percent" && invoiceDiscount && Number(invoiceDiscount) > 100) {
    issues.push({ field: "invoice_discount", message: "Invoice discount percentage cannot exceed 100." });
    totalsFieldsValid = false;
  }
  if (taxRate && !isSupportedNonNegative(taxRate, SALE_MONEY_DECIMAL_PLACES)) {
    issues.push({ field: "tax", message: "Tax rate must be non-negative and use up to two decimal places." });
    totalsFieldsValid = false;
  } else if (taxRate && Number(taxRate) > 999.99) {
    issues.push({ field: "tax", message: "Tax rate cannot exceed 999.99." });
    totalsFieldsValid = false;
  }
  if (input.allowInvoiceAdjustments === false && (Number(invoiceDiscount || 0) > 0 || Number(taxRate || 0) > 0)) {
    issues.push({ field: "invoice_discount", message: "Invoice discount and tax are not available for this approval flow." });
    totalsFieldsValid = false;
  }

  let amounts: SaleAmounts | undefined;
  if (lineFieldsValid.every(Boolean) && totalsFieldsValid) {
    try {
      amounts = calculateSaleAmounts(input.lines.map(line => ({
        quantity: line.quantity.trim(),
        sellingPrice: line.selling_price.trim(),
        discount: line.discount?.trim() || "0",
      })), {
        invoiceDiscount: invoiceDiscount || "0",
        invoiceDiscountType: input.invoiceDiscountType,
        taxRate: taxRate || "0",
      });
    } catch (error) {
      issues.push(issueFromCalculationError(error instanceof Error ? error.message : "Invalid sale totals."));
    }
  }

  let cashSummary: RetailDrawerSummary | undefined;
  if (input.validateCash && input.paymentType === "cash" && input.cashReceived !== undefined) {
    const cash = input.cashReceived.trim();
    if (cash && !isSupportedNonNegative(cash, SALE_MONEY_DECIMAL_PLACES)) {
      issues.push({ field: "cash_received", message: "Cash received must be non-negative and use up to two decimal places." });
    } else if (amounts) {
      cashSummary = buildRetailDrawerSummary({ total: amounts.total, received: cash });
      if (cashSummary.status === "cash-short") {
        issues.push({ field: "cash_received", message: "Cash received is less than the sale total." });
      }
    }
  }

  return { valid: issues.length === 0, issues, amounts, lineTotals, cashSummary };
}
