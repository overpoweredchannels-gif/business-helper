// Inventory Management (Phase 1) — validation, the single source of truth
// for inventory input rules.
//
// Used by:
//   - client: src/app/page.tsx (stock adjustment form)
//   - server: src/app/api/inventory/adjust/route.ts
// The database mirrors these rules with CHECK constraints and guards inside
// adjust_inventory() in src/lib/inventory/schema.sql — keep them in sync.

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

// Returns a valid YYYY-MM-DD date string, or null when the input is not a
// parseable date (mirrors the DB `date` column semantics).
export const normalizeExpiryDate = (value: unknown): string | null => {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  // Already in canonical form — pass through to avoid timezone shifting.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // Parse as UTC so toISOString() cannot shift the day for local offsets.
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

// ─── Stock adjustment ───────────────────────────────────────────────────────

export interface InventoryAdjustmentInputLike {
  product_id: number | string | null | undefined;
  quantity_delta: number | string | null | undefined;
  reason: string | null | undefined;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export const validateAdjustmentInput = (input: InventoryAdjustmentInputLike): ValidationResult => {
  const errors: string[] = [];
  const productIdText = normalizeOptionalText(String(input.product_id ?? ""));
  const quantityDelta = normalizeOptionalNumber(input.quantity_delta);
  const reason = normalizeOptionalText(input.reason);
  const batchNumber = normalizeOptionalText(input.batch_number);
  const expiryDate = normalizeExpiryDate(input.expiry_date);

  // product_id may be an integer (dev) or uuid (production); only require a
  // non-empty value here — ownership is enforced inside adjust_inventory().
  if (productIdText === null) {
    errors.push("Select a product");
  }

  if (quantityDelta === null || quantityDelta === 0) {
    errors.push("Quantity change must be a non-zero number");
  }

  if (!reason) {
    errors.push("Reason is required");
  } else if (reason.length > MAX_REASON_LENGTH) {
    errors.push(`Reason must be ${MAX_REASON_LENGTH} characters or fewer`);
  }

  if (batchNumber && batchNumber.length > MAX_BATCH_NUMBER_LENGTH) {
    errors.push(`Batch number must be ${MAX_BATCH_NUMBER_LENGTH} characters or fewer`);
  }

  if (expiryDate === null && input.expiry_date !== undefined && input.expiry_date !== null && input.expiry_date !== "") {
    errors.push("Expiry date is not a valid date");
  }

  return { ok: errors.length === 0, errors };
};
