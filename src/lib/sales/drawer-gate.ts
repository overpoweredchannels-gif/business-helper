/**
 * Owner-controlled No Sale (manual drawer open) gate.
 *
 * Market standard (Toast 1.13 / Square "Open Cash Drawer Outside of a
 * Transaction" / Lightspeed Register Managers): opening the drawer
 * outside a sale is permission-gated and always audit-logged. Here:
 * owner/admin always; staff only when the owner enables it through the
 * organization setting `drawer_no_sale_staff_allowed` (default false —
 * the gate stays shut until the owner opens it).
 *
 * The column arrives with the drawer-events migration; until it exists
 * every read resolves to false, so staff behaviour is unchanged.
 *
 * A manager-PIN override (Square pattern) is deliberately not part of
 * this gate yet: the app has no PIN credential store, and inventing one
 * is out of scope for the drawer round.
 */
export type NoSaleOutcome = "allowed" | "blocked";

/** Only an explicit true opens the gate for staff — the safe default. */
export function parseDrawerNoSaleStaffAllowed(value: unknown): boolean {
  return value === true;
}

export function noSaleOutcome(input: {
  role?: string | null;
  staffAllowed?: unknown;
}): NoSaleOutcome {
  if (input.role === "owner" || input.role === "admin") return "allowed";
  return parseDrawerNoSaleStaffAllowed(input.staffAllowed) ? "allowed" : "blocked";
}

/** Preset No Sale reasons (Toast/Shopify reason-code pattern). A reason
 * is mandatory before the kick fires; "other" requires a free-text note. */
export const NO_SALE_REASON_CODES = [
  "making-change",
  "counting-drawer",
  "pay-in",
  "pay-out",
  "other",
] as const;

export type NoSaleReasonCode = (typeof NO_SALE_REASON_CODES)[number];

export function isNoSaleReasonValid(input: {
  reasonCode?: string | null;
  reasonNote?: string | null;
}): boolean {
  if (!input.reasonCode || !(NO_SALE_REASON_CODES as readonly string[]).includes(input.reasonCode)) {
    return false;
  }
  if (input.reasonCode === "other" && !input.reasonNote?.trim()) return false;
  return true;
}
