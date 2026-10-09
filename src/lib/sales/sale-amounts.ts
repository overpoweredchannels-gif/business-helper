export type SaleAmountLine = {
  quantity: number | string;
  sellingPrice: number | string;
  discount?: number | string;
};

export type SaleAmountOptions = {
  invoiceDiscount?: number | string;
  invoiceDiscountType?: "flat" | "percent";
  taxRate?: number | string;
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

// Contract: mirror create_sales_invoice_atomic's accepted input scales (quantity
// to 3 places; prices, discounts and rates to 2), PostgreSQL NUMERIC round()
// ties away from zero, and numeric(14,2) money columns. Quantity inputs are
// additionally bounded so every thousandth remains exactly representable.
const MAX_QUANTITY_MILLI = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_MONEY_CENTS = BigInt(99_999_999_999_999);
const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
const MAX_DECIMAL_SHIFT = 400;

type DecimalValue = number | string;
type DecimalParts = { coefficient: bigint; scale: number };

function powerOfTen(power: number): bigint {
  if (!Number.isInteger(power) || power < 0 || power > MAX_DECIMAL_SHIFT) {
    throw new RangeError("Decimal value is outside the supported calculation range.");
  }
  return BigInt(10) ** BigInt(power);
}

function decimalParts(value: DecimalValue): DecimalParts {
  const raw = typeof value === "number" ? String(value) : value.trim();
  const match = DECIMAL_PATTERN.exec(raw);
  if (!match) throw new RangeError("Expected a finite decimal value.");

  const whole = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_SHIFT) {
    throw new RangeError("Decimal exponent is outside the supported calculation range.");
  }

  const sign = match[1] === "-" ? -BigInt(1) : BigInt(1);
  let coefficient = sign * BigInt(`${whole}${fraction}` || "0");
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= powerOfTen(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function roundDivideHalfAwayFromZero(value: bigint, divisor: bigint): bigint {
  const sign = value < BigInt(0) ? -BigInt(1) : BigInt(1);
  const magnitude = value < BigInt(0) ? -value : value;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  return sign * (quotient + (remainder * BigInt(2) >= divisor ? BigInt(1) : BigInt(0)));
}

function roundedIntegerAtScale(parts: DecimalParts, targetScale: number): bigint {
  const shift = targetScale - parts.scale;
  return shift >= 0
    ? parts.coefficient * powerOfTen(shift)
    : roundDivideHalfAwayFromZero(parts.coefficient, powerOfTen(-shift));
}

function checkedMoneyCents(cents: bigint): bigint {
  if (cents > MAX_MONEY_CENTS || cents < -MAX_MONEY_CENTS) {
    throw new RangeError("Money exceeds the supported cent-precision range.");
  }
  return cents;
}

export function moneyToCents(value: DecimalValue): bigint {
  return checkedMoneyCents(roundedIntegerAtScale(decimalParts(value), SALE_MONEY_DECIMAL_PLACES));
}

export function centsToMoney(cents: bigint): number {
  return Number(checkedMoneyCents(cents)) / 100;
}

function assertSupportedQuantity(parts: DecimalParts): void {
  const magnitude = parts.coefficient < BigInt(0) ? -parts.coefficient : parts.coefficient;
  if (magnitude * BigInt(1000) > MAX_QUANTITY_MILLI * powerOfTen(parts.scale)) {
    throw new RangeError("Quantity exceeds the supported thousandth-precision range.");
  }
}

function assertDecimalPlaces(value: DecimalValue, places: number, label: string): void {
  const parts = decimalParts(value);
  if (parts.scale > places && parts.coefficient % powerOfTen(parts.scale - places) !== BigInt(0)) {
    throw new RangeError(`${label} exceeds the supported ${places}-decimal precision.`);
  }
}

function saleLineCents(line: SaleAmountLine): { gross: bigint; discount: bigint } {
  const quantity = line.quantity;
  const sellingPrice = line.sellingPrice;
  const discount = line.discount ?? 0;
  const quantityParts = decimalParts(quantity);
  const priceParts = decimalParts(sellingPrice);
  const discountParts = decimalParts(discount);
  assertDecimalPlaces(quantity, SALE_QUANTITY_DECIMAL_PLACES, "Quantity");
  assertDecimalPlaces(sellingPrice, SALE_MONEY_DECIMAL_PLACES, "Selling price");
  assertDecimalPlaces(discount, SALE_MONEY_DECIMAL_PLACES, "Line discount");
  assertSupportedQuantity(quantityParts);
  if (quantityParts.coefficient <= BigInt(0)) throw new RangeError("Quantity must be greater than zero.");
  const priceCents = moneyToCents(sellingPrice);
  const discountCents = moneyToCents(discount);
  if (priceCents < BigInt(0) || discountCents < BigInt(0)) throw new RangeError("Selling price and line discount cannot be negative.");

  const productScale = quantityParts.scale + priceParts.scale;
  const comparisonScale = Math.max(productScale, discountParts.scale);
  const product = quantityParts.coefficient * priceParts.coefficient * powerOfTen(comparisonScale - productScale);
  const discountValue = discountParts.coefficient * powerOfTen(comparisonScale - discountParts.scale);
  if (discountValue > product) throw new RangeError("Line discount cannot exceed quantity multiplied by selling price.");

  const gross = checkedMoneyCents(roundedIntegerAtScale({
    coefficient: quantityParts.coefficient * priceParts.coefficient,
    scale: productScale,
  }, SALE_MONEY_DECIMAL_PLACES));
  return { gross, discount: discountCents };
}

export function hasAllowedPrecision(value: string | number, decimalPlaces: number): boolean {
  const raw = String(value).trim();
  const match = /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))$/.exec(raw);
  if (!match) return false;
  const fraction = match[1] ?? match[2] ?? "";
  if (fraction.length > decimalPlaces && !/^0*$/.test(fraction.slice(decimalPlaces))) return false;

  const limit = decimalPlaces === SALE_QUANTITY_DECIMAL_PLACES
    ? MAX_QUANTITY_MILLI
    : decimalPlaces === SALE_MONEY_DECIMAL_PLACES
      ? MAX_MONEY_CENTS
      : null;
  if (limit === null) return true;

  const sign = raw.startsWith("-") ? -BigInt(1) : BigInt(1);
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole = "0", decimals = ""] = unsigned.split(".");
  const scaled = BigInt(`${whole}${decimals.slice(0, decimalPlaces).padEnd(decimalPlaces, "0")}` || "0");
  return scaled * sign <= limit && scaled * sign >= -limit;
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return centsToMoney(moneyToCents(value));
}

export function calculateSaleLineTotal(line: SaleAmountLine): number {
  const amounts = saleLineCents(line);
  return centsToMoney(amounts.gross - amounts.discount);
}

export function calculateSaleAmounts(
  lines: SaleAmountLine[],
  options: SaleAmountOptions = {},
): SaleAmounts {
  if (typeof options.invoiceDiscount === "number" && !Number.isFinite(options.invoiceDiscount)) {
    throw new RangeError("Invoice discount must be a finite decimal value.");
  }
  if (typeof options.taxRate === "number" && !Number.isFinite(options.taxRate)) {
    throw new RangeError("Tax rate must be a finite decimal value.");
  }
  if (options.invoiceDiscountType !== undefined && !["flat", "percent"].includes(options.invoiceDiscountType)) {
    throw new RangeError("Invoice discount type must be flat or percent.");
  }
  const normalizedLines = lines.map(saleLineCents);
  const lineSubtotalCents = checkedMoneyCents(normalizedLines.reduce((sum, line) => sum + line.gross, BigInt(0)));
  const lineDiscountCents = checkedMoneyCents(normalizedLines.reduce((sum, line) => sum + line.discount, BigInt(0)));
  const subtotalCents = checkedMoneyCents(normalizedLines.reduce((sum, line) => sum + line.gross - line.discount, BigInt(0)));
  const invoiceDiscountInput = options.invoiceDiscount ?? 0;
  assertDecimalPlaces(invoiceDiscountInput, SALE_MONEY_DECIMAL_PLACES, "Invoice discount");
  const invoiceDiscountInputCents = moneyToCents(invoiceDiscountInput);
  if (options.invoiceDiscountType === "percent" && (invoiceDiscountInputCents < BigInt(0) || invoiceDiscountInputCents > BigInt(10_000))) {
    throw new RangeError("Percentage invoice discount must be between 0 and 100.");
  }
  if (options.invoiceDiscountType !== "percent" && invoiceDiscountInputCents < BigInt(0)) {
    throw new RangeError("Flat invoice discount cannot be negative.");
  }
  if (options.invoiceDiscountType !== "percent" && invoiceDiscountInputCents > subtotalCents) {
    throw new RangeError("Flat invoice discount cannot exceed the sale subtotal.");
  }
  const invoiceDiscountCents = options.invoiceDiscountType === "percent"
    ? checkedMoneyCents(roundDivideHalfAwayFromZero(subtotalCents * invoiceDiscountInputCents, BigInt(10_000)))
    : invoiceDiscountInputCents;
  const taxableCents = subtotalCents > invoiceDiscountCents ? subtotalCents - invoiceDiscountCents : BigInt(0);
  const taxRate = options.taxRate ?? 0;
  assertDecimalPlaces(taxRate, SALE_MONEY_DECIMAL_PLACES, "Tax rate");
  const taxRateHundredths = moneyToCents(taxRate);
  if (taxRateHundredths < BigInt(0) || taxRateHundredths > BigInt(99_999)) throw new RangeError("Tax rate must be between 0 and 999.99.");
  const taxCents = checkedMoneyCents(roundDivideHalfAwayFromZero(taxableCents * taxRateHundredths, BigInt(10_000)));
  const totalCents = checkedMoneyCents(taxableCents + taxCents);

  return {
    lineSubtotal: centsToMoney(lineSubtotalCents),
    lineDiscount: centsToMoney(lineDiscountCents),
    subtotal: centsToMoney(subtotalCents),
    invoiceDiscount: centsToMoney(invoiceDiscountCents),
    taxableAmount: centsToMoney(taxableCents),
    tax: centsToMoney(taxCents),
    total: centsToMoney(totalCents),
  };
}
