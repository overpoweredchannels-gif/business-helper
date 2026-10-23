/**
 * Cash drawer kick seam (ESC/POS `ESC p`).
 *
 * Behaviour follows the market-standard spec (docs: Cash Drawer Market
 * Standard Spec, 2026-10-23):
 *  - The drawer opens automatically for CASH money movement only: a
 *    completed cash sale, a cash refund. Never for card or credit.
 *  - The kick is fire-and-forget: it can never block, delay the
 *    completion of, or roll back a sale. Every attempt resolves as an
 *    outcome and is audit-recorded (src/lib/print/drawer-events.ts).
 *  - Routes: "print" — the kick rides the receipt print job through the
 *    printer driver's peripheral setting (Document Bottom); the app
 *    itself sends no drawer bytes on this route. "serial" / "usb" —
 *    direct ESC/POS bytes over WebSerial (preferred on Windows tills,
 *    virtual COM port) or WebUSB.
 *
 * This module is transport- and storage-agnostic: transports and the
 * event recorder are injected, so the whole kick decision is unit
 * testable. Browser transports live in drawer-transport.ts, per-till
 * settings in drawer-settings.ts.
 */

export type DrawerEventType =
  | "cash-sale"
  | "cash-refund"
  | "no-sale"
  | "pay-in"
  | "drop"
  | "test";

export type DrawerRoute = "print" | "serial" | "usb";
export type DrawerPin = 2 | 5;
export type DrawerResult = "sent" | "failed";

/** ESC/POS pulse timing (spec Q4): t1=0x19 → 50 ms ON, t2=0xFA → 500 ms OFF. */
export const DRAWER_KICK_ON_BYTE = 0x19;
export const DRAWER_KICK_OFF_BYTE = 0xfa;

/**
 * Build the `ESC p m t1 t2` drawer-kick command. The pin byte selects
 * the printer's drawer kick-out connector: 0x00 → pin 2 (the default),
 * 0x01 → pin 5 (the field fix when a drawer does not fire on pin 2).
 */
export function buildDrawerKickBytes(pin: DrawerPin): Uint8Array {
  return new Uint8Array([0x1b, 0x70, pin === 5 ? 0x01 : 0x00, DRAWER_KICK_ON_BYTE, DRAWER_KICK_OFF_BYTE]);
}

// ---------------------------------------------------------------------------
// Trigger matrix — the ONLY automatic kicks. Anything not listed here
// (held sales, drafts, reprints, quotes, session open/close, card and
// credit tenders) never fires a kick.
// ---------------------------------------------------------------------------

/** A completed sale kicks only when cash physically moves. */
export function drawerEventTypeForSale(input: {
  paymentType?: string | null;
}): DrawerEventType | null {
  return input.paymentType === "cash" ? "cash-sale" : null;
}

/**
 * A completed sales return kicks when the refund leaves the drawer in
 * cash. A return linked to a credit invoice offsets the receivable (no
 * cash moves); a return linked to a card sale refunds to the card. An
 * unlinked return has no tender record — the retail counter default is
 * cash back over the counter, so it kicks.
 */
export function drawerEventTypeForReturn(input: {
  linkedPaymentType?: string | null;
}): DrawerEventType | null {
  if (input.linkedPaymentType === "card" || input.linkedPaymentType === "credit") return null;
  return "cash-refund";
}

// ---------------------------------------------------------------------------
// Audit record — one row per kick attempt (and per gated manual open).
// Append-only: rows are never edited or deleted; corrections are new
// rows. Mirrors the drawer_events table (Drawer_Events_Migration).
// ---------------------------------------------------------------------------

export interface DrawerEventRecord {
  organization_id: string;
  till_scope: string;
  actor_profile_id: string | null;
  actor_name: string | null;
  authorised_by_profile_id: string | null;
  event_type: DrawerEventType;
  linked_sale_id: string | null;
  linked_movement_id: string | null;
  amount: number | null;
  reason_code: string | null;
  reason_note: string | null;
  route: DrawerRoute;
  kick_pin: DrawerPin;
  result: DrawerResult;
  error: string | null;
}

export interface DrawerEventInput {
  organizationId: string;
  tillScope: string;
  actorProfileId?: string | null;
  actorName?: string | null;
  authorisedByProfileId?: string | null;
  eventType: DrawerEventType;
  linkedSaleId?: string | null;
  linkedMovementId?: string | null;
  amount?: number | null;
  reasonCode?: string | null;
  reasonNote?: string | null;
  route: DrawerRoute;
  pin: DrawerPin;
  result: DrawerResult;
  error?: string | null;
}

/**
 * Build the audit record for one kick. For manual opens (no-sale, test)
 * the actor is also the authoriser of record: permission for the open
 * comes from their role or the owner's staff setting, and a separate
 * authoriser only exists with a future PIN-override flow.
 */
export function buildDrawerEventRecord(input: DrawerEventInput): DrawerEventRecord {
  const manual = input.eventType === "no-sale" || input.eventType === "test";
  return {
    organization_id: input.organizationId,
    till_scope: input.tillScope,
    actor_profile_id: input.actorProfileId ?? null,
    actor_name: input.actorName ?? null,
    authorised_by_profile_id:
      input.authorisedByProfileId ?? (manual ? input.actorProfileId ?? null : null),
    event_type: input.eventType,
    linked_sale_id: input.linkedSaleId ?? null,
    linked_movement_id: input.linkedMovementId ?? null,
    amount: input.amount ?? null,
    reason_code: manual ? input.reasonCode ?? null : null,
    reason_note: manual ? input.reasonNote ?? null : null,
    route: input.route,
    kick_pin: input.pin,
    result: input.result,
    error: input.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Kick orchestration.
// ---------------------------------------------------------------------------

export interface DrawerTransports {
  /** Print route: the kick rides the receipt print job (driver). For
   * manual opens there is no receipt, so the transport prints a minimal
   * slip to push a job through the drawer-linked driver profile. */
  print: (eventType: DrawerEventType) => Promise<void>;
  /** Direct route: write raw ESC/POS bytes to the till's printer. */
  serial: (bytes: Uint8Array) => Promise<void>;
  usb: (bytes: Uint8Array) => Promise<void>;
}

export interface DrawerKickRequest {
  settings: { enabled: boolean; route: DrawerRoute; pin: DrawerPin };
  event: Omit<DrawerEventInput, "route" | "pin" | "result" | "error">;
}

export interface DrawerKickDeps {
  transports: DrawerTransports;
  record: (record: DrawerEventRecord) => Promise<void>;
  /** Hard bound on any single transport attempt, so a stuck port can
   * never delay a sale. Tests inject a shorter bound. */
  timeoutMs?: number;
}

export interface DrawerKickOutcome {
  /** False only when the till's drawer is disabled and the event is an
   * automatic trigger — then nothing is attempted and nothing is
   * recorded (a disabled drawer must not spam the audit log). */
  attempted: boolean;
  result: DrawerResult | null;
  route: DrawerRoute;
  pin: DrawerPin;
  error: string | null;
  record: DrawerEventRecord | null;
}

const DEFAULT_KICK_TIMEOUT_MS = 3000;

function withTimeout(promise: Promise<void>, milliseconds: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("drawer-timeout")), milliseconds);
    promise.then(
      () => { clearTimeout(timer); resolve(); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

function errorCause(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 200);
  return "drawer-transport-failed";
}

/**
 * Fire one drawer kick and audit-record the attempt. NEVER throws and
 * never rejects: a failed kick resolves as `{ result: "failed" }` with
 * the cause, the sale proceeds, and the cashier uses the physical key.
 */
export async function kickDrawer(
  request: DrawerKickRequest,
  deps: DrawerKickDeps,
): Promise<DrawerKickOutcome> {
  const { settings, event } = request;
  const base = { route: settings.route, pin: settings.pin };

  if (!settings.enabled && event.eventType !== "no-sale" && event.eventType !== "test") {
    return { attempted: false, result: null, ...base, error: null, record: null };
  }

  let result: DrawerResult = "sent";
  let error: string | null = null;

  if (!settings.enabled) {
    result = "failed";
    error = "drawer-disabled";
  } else {
    try {
      const bytes = buildDrawerKickBytes(settings.pin);
      const attempt =
        settings.route === "print"
          ? deps.transports.print(event.eventType)
          : settings.route === "serial"
            ? deps.transports.serial(bytes)
            : deps.transports.usb(bytes);
      await withTimeout(attempt, deps.timeoutMs ?? DEFAULT_KICK_TIMEOUT_MS);
    } catch (caught) {
      result = "failed";
      error = errorCause(caught);
    }
  }

  const record = buildDrawerEventRecord({ ...event, ...base, result, error });
  try {
    await deps.record(record);
  } catch {
    // Recording is itself best-effort at this seam: the production
    // recorder (drawer-events.ts) queues to a local outbox on failure
    // and never throws, so this guard only covers injected recorders.
  }
  return { attempted: true, result, ...base, error, record };
}
