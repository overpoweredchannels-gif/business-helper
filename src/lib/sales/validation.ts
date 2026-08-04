// Sales Management (Phase 4) — validation, the single source of truth for
// sales order / sales return / sales invoice input rules.
//
// Used by:
//   - client: src/app/page.tsx (SO create, sales invoice create, return create)
//   - server: src/app/api/sales/returns/route.ts
// The database mirrors these rules with CHECK constraints in
// src/lib/sales/schema.sql and the Phase 4 migration — keep them in sync.

export const MAX_NOTES_LENGTH = 500;
export const MAX_REASON_LENGTH = 500;
export const MAX_BATCH_NUMBER_LENGTH = 100;
export const MAX_CUSTOMER_NAME_LENGTH = 150;
export const MAX_TEXT_FIELD_LENGTH = 100;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeOptionalDate = (value: unknown): string | null => {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

// ─── Sales orders ───────────────────────────────────────────────────────────

export interface SalesOrderLineLike {
  product_id?: string | number | null;
  quantity?: string | number | null;
  unit_price?: string | number | null;
  discount?: string | number | null;
}

export interface SalesOrderInputLike {
  customer_id: string | null | undefined;
  order_date?: string | null;
  expected_date?: string | null;
  notes?: string | null;
  lines: SalesOrderLineLike[];
}

export function validateSalesOrderInput(input: SalesOrderInputLike): ValidationResult {
  const errors: string[] = [];

  if (!input.customer_id) {
    errors.push("A customer is required.");
  }

  const notes = normalizeOptionalText(input.notes);
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    errors.push(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
  }

  const orderDate = normalizeOptionalDate(input.order_date);
  if (input.order_date && !orderDate) {
    errors.push("Order date is not a valid date.");
  }

  const expectedDate = normalizeOptionalDate(input.expected_date);
  if (input.expected_date && !expectedDate) {
    errors.push("Expected date is not a valid date.");
  }

  if (orderDate && expectedDate && expectedDate < orderDate) {
    errors.push("Expected date cannot be before the order date.");
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    errors.push("Add at least one product line.");
  } else {
    input.lines.forEach((line, index) => {
      const label = `Line ${index + 1}`;
      if (!line.product_id) {
        errors.push(`${label}: select a product.`);
      }
      const quantity = normalizeOptionalNumber(line.quantity);
      if (quantity === null || quantity <= 0) {
        errors.push(`${label}: quantity must be greater than zero.`);
      }
      const unitPrice = normalizeOptionalNumber(line.unit_price);
      if (unitPrice !== null && unitPrice < 0) {
        errors.push(`${label}: unit price cannot be negative.`);
      }
      const discount = normalizeOptionalNumber(line.discount);
      if (discount !== null && discount < 0) {
        errors.push(`${label}: discount cannot be negative.`);
      }
      if (unitPrice !== null && discount !== null && discount > unitPrice) {
        errors.push(`${label}: discount cannot exceed the unit price.`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

// ─── Sales invoices ─────────────────────────────────────────────────────────

export interface SalesInvoiceLineLike {
  product_id?: string | number | null;
  quantity?: string | number | null;
  selling_price?: string | number | null;
  discount?: string | number | null;
}

export interface SalesInvoiceInputLike {
  customer_id: string | null | undefined;
  sale_date?: string | null;
  payment_type?: string | null;
  notes?: string | null;
  discount_amount?: string | number | null;
  tax_rate?: string | number | null;
  lines: SalesInvoiceLineLike[];
}

export function validateSalesInvoiceInput(input: SalesInvoiceInputLike): ValidationResult {
  const errors: string[] = [];

  if (!input.customer_id) {
    errors.push("A customer is required.");
  }

  const paymentType = normalizeOptionalText(input.payment_type);
  if (paymentType && !["cash", "credit"].includes(paymentType.toLowerCase())) {
    errors.push("Payment type must be 'cash' or 'credit'.");
  }

  const saleDate = normalizeOptionalDate(input.sale_date);
  if (input.sale_date && !saleDate) {
    errors.push("Sale date is not a valid date.");
  }

  const notes = normalizeOptionalText(input.notes);
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    errors.push(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
  }

  const discountAmount = normalizeOptionalNumber(input.discount_amount);
  if (discountAmount !== null && discountAmount < 0) {
    errors.push("Invoice discount cannot be negative.");
  }

  const taxRate = normalizeOptionalNumber(input.tax_rate);
  if (taxRate !== null && (taxRate < 0 || taxRate > 100)) {
    errors.push("Tax rate must be between 0 and 100.");
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    errors.push("Add at least one product line.");
  } else {
    input.lines.forEach((line, index) => {
      const label = `Line ${index + 1}`;
      if (!line.product_id) {
        errors.push(`${label}: select a product.`);
      }
      const quantity = normalizeOptionalNumber(line.quantity);
      if (quantity === null || quantity <= 0) {
        errors.push(`${label}: quantity must be greater than zero.`);
      }
      const sellingPrice = normalizeOptionalNumber(line.selling_price);
      if (sellingPrice === null || sellingPrice < 0) {
        errors.push(`${label}: selling price is required and cannot be negative.`);
      }
      const discount = normalizeOptionalNumber(line.discount);
      if (discount !== null && discount < 0) {
        errors.push(`${label}: discount cannot be negative.`);
      }
      if (sellingPrice !== null && discount !== null && discount > sellingPrice) {
        errors.push(`${label}: discount cannot exceed the selling price.`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

// ─── Sales returns ──────────────────────────────────────────────────────────

export interface SalesReturnLineLike {
  product_id?: string | number | null;
  quantity?: string | number | null;
  unit_price?: string | number | null;
  discount?: string | number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export interface SalesReturnInputLike {
  customer_id: string | null | undefined;
  return_date?: string | null;
  reason?: string | null;
  lines: SalesReturnLineLike[];
}

export function validateSalesReturnInput(input: SalesReturnInputLike): ValidationResult {
  const errors: string[] = [];

  if (!input.customer_id) {
    errors.push("A customer is required.");
  }

  const reason = normalizeOptionalText(input.reason);
  if (reason && reason.length > MAX_REASON_LENGTH) {
    errors.push(`Reason must be ${MAX_REASON_LENGTH} characters or fewer.`);
  }

  const returnDate = normalizeOptionalDate(input.return_date);
  if (input.return_date && !returnDate) {
    errors.push("Return date is not a valid date.");
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    errors.push("Add at least one product line.");
  } else {
    input.lines.forEach((line, index) => {
      const label = `Line ${index + 1}`;
      if (!line.product_id) {
        errors.push(`${label}: select a product.`);
      }
      const quantity = normalizeOptionalNumber(line.quantity);
      if (quantity === null || quantity <= 0) {
        errors.push(`${label}: quantity must be greater than zero.`);
      }
      const unitPrice = normalizeOptionalNumber(line.unit_price);
      if (unitPrice !== null && unitPrice < 0) {
        errors.push(`${label}: unit price cannot be negative.`);
      }
      const discount = normalizeOptionalNumber(line.discount);
      if (discount !== null && discount < 0) {
        errors.push(`${label}: discount cannot be negative.`);
      }
      if (unitPrice !== null && discount !== null && discount > unitPrice) {
        errors.push(`${label}: discount cannot exceed the unit price.`);
      }
      const batch = normalizeOptionalText(line.batch_number);
      if (batch && batch.length > MAX_BATCH_NUMBER_LENGTH) {
        errors.push(`${label}: batch number is too long.`);
      }
      if (line.expiry_date && !normalizeOptionalDate(line.expiry_date)) {
        errors.push(`${label}: expiry date is not a valid date.`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}
