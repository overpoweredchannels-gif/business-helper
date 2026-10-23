/**
 * Owner-controlled staff-sale gate.
 *
 * The owner decides how staff sales are created:
 *   - "approval" (default): a staff sale/invoice is submitted as a draft
 *     into the approval pipeline (POST /api/sales/drafts) and only becomes
 *     a confirmed invoice when the owner approves it.
 *   - "direct": staff create sales/invoices through the normal save path,
 *     exactly like an owner (all other permissions still apply).
 *
 * Owner/admin users are never gated ("unaffected").
 *
 * The mode is read from the organization's `staff_sales_mode` value. That
 * column does not exist yet — it needs one additive migration (see the
 * overselling_policy precedent on organizations). Until it lands, every
 * read resolves to "approval", which is exactly the pre-setting behaviour,
 * so this gate changes nothing for existing organizations.
 */
export type StaffSalesMode = "direct" | "approval";
export type StaffSaleOutcome = "direct" | "approval" | "unaffected";

/** Anything that is not exactly "direct" means approval — the safe default. */
export function parseStaffSalesMode(value: unknown): StaffSalesMode {
  return value === "direct" ? "direct" : "approval";
}

export function staffSaleOutcome(input: {
  role?: string | null;
  mode?: unknown;
}): StaffSaleOutcome {
  if (input.role === "owner" || input.role === "admin") return "unaffected";
  return parseStaffSalesMode(input.mode);
}
