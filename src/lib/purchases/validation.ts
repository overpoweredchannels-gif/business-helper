// Purchase Management (Phase 1) — validation, the single source of truth for
// purchase order / purchase return input rules.
//
// Used by:
//   - client: src/app/page.tsx (PO create / receive, return create forms)
// The database mirrors these rules with CHECK constraints in
// src/lib/purchases/schema.sql — keep them in sync.

export const MAX_NOTES_LENGTH = 500;
export const MAX_REASON_LENGTH = 500;
export const MAX_BATCH_NUMBER_LENGTH = 100;

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

// ─── Purchase orders ────────────────────────────────────────────────────────

export interface PurchaseOrderLineLike {
  product_id?: string | number | null;
  quantity?: string | number | null;
  unit_price?: string | number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export interface PurchaseOrderInputLike {
  supplier_id: string | null | undefined;
  order_date?: string | null;
  expected_date?: string | null;
  notes?: string | null;
  lines: PurchaseOrderLineLike[];
}

export function validatePurchaseOrderInput(input: PurchaseOrderInputLike): ValidationResult {
  const errors: string[] = [];

  if (!input.supplier_id) {
    errors.push("A supplier is required.");
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

// ─── Purchase order receiving ───────────────────────────────────────────────

export interface ReceiveLineLike {
  product_id?: string | number | null;
  /** Remaining (not yet received) quantity on the PO line. */
  remaining?: string | number | null;
  receive_quantity?: string | number | null;
  unit_price?: string | number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export function validateReceiveQuantities(lines: ReceiveLineLike[]): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(lines) || lines.length === 0) {
    errors.push("Nothing to receive — add at least one product line.");
    return { ok: false, errors };
  }

  let anyReceiving = false;
  lines.forEach((line, index) => {
    const label = `Line ${index + 1}`;
    const receiveQuantity = normalizeOptionalNumber(line.receive_quantity);
    if (receiveQuantity === null || receiveQuantity <= 0) return;
    anyReceiving = true;
    const remaining = normalizeOptionalNumber(line.remaining) ?? 0;
    if (receiveQuantity > remaining) {
      errors.push(`${label}: receive quantity cannot exceed the remaining quantity (${remaining}).`);
    }
    const unitPrice = normalizeOptionalNumber(line.unit_price);
    if (unitPrice !== null && unitPrice < 0) {
      errors.push(`${label}: unit price cannot be negative.`);
    }
  });

  if (!anyReceiving) {
    errors.push("Enter a quantity to receive on at least one line.");
  }

  return { ok: errors.length === 0, errors };
}

// ─── Purchase returns ───────────────────────────────────────────────────────

export interface PurchaseReturnLineLike {
  product_id?: string | number | null;
  quantity?: string | number | null;
  unit_price?: string | number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export interface PurchaseReturnInputLike {
  supplier_id: string | null | undefined;
  return_date?: string | null;
  reason?: string | null;
  lines: PurchaseReturnLineLike[];
}

export function validatePurchaseReturnInput(input: PurchaseReturnInputLike): ValidationResult {
  const errors: string[] = [];

  if (!input.supplier_id) {
    errors.push("A supplier is required.");
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
