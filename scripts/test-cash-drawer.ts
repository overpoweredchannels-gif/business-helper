import assert from "node:assert/strict";
import {
  buildDrawerEventRecord,
  buildDrawerKickBytes,
  drawerEventTypeForReturn,
  drawerEventTypeForSale,
  kickDrawer,
  type DrawerEventRecord,
  type DrawerTransports,
} from "../src/lib/print/drawer";
import {
  DEFAULT_DRAWER_SETTINGS,
  drawerSettingsStorageKey,
  parseDrawerSettings,
  readDrawerSettings,
  writeDrawerSettings,
} from "../src/lib/print/drawer-settings";
import {
  countNoSaleEvents,
  createDrawerEventRecorder,
  drawerOutboxStorageKey,
  filterDrawerEvents,
  flushDrawerOutbox,
  parseDrawerOutbox,
  readDrawerOutbox,
  type DrawerEventInsert,
} from "../src/lib/print/drawer-events";
import {
  isNoSaleReasonValid,
  noSaleOutcome,
  parseDrawerNoSaleStaffAllowed,
} from "../src/lib/sales/drawer-gate";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key: string): string | null { return map.get(key) ?? null; },
    setItem(key: string, value: string): void { map.set(key, value); },
  };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const SCOPE = `${ORG}:${PROFILE}`;

function baseEvent(overrides: Partial<Parameters<typeof buildDrawerEventRecord>[0]> = {}) {
  return {
    organizationId: ORG,
    tillScope: SCOPE,
    actorProfileId: PROFILE,
    actorName: "Counter One",
    eventType: "cash-sale" as const,
    linkedSaleId: "sale-1",
    amount: 1250,
    route: "serial" as const,
    pin: 2 as const,
    result: "sent" as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Kick bytes — ESC p m t1 t2 (spec Q4): pin 2 → m=0x00, pin 5 → m=0x01,
// t1=0x19 (50 ms ON), t2=0xFA (500 ms OFF).
// ---------------------------------------------------------------------------

assert.deepEqual([...buildDrawerKickBytes(2)], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
assert.deepEqual([...buildDrawerKickBytes(5)], [0x1b, 0x70, 0x01, 0x19, 0xfa]);

// ---------------------------------------------------------------------------
// Till settings: defaults, round-trip, scope isolation, corrupt fallback.
// ---------------------------------------------------------------------------

assert.deepEqual(parseDrawerSettings(null), DEFAULT_DRAWER_SETTINGS);
assert.deepEqual(parseDrawerSettings("not json"), DEFAULT_DRAWER_SETTINGS);
assert.deepEqual(parseDrawerSettings('{"route":"carrier-pigeon","pin":9}'), DEFAULT_DRAWER_SETTINGS);
assert.deepEqual(
  parseDrawerSettings('{"enabled":false,"route":"usb","pin":5}'),
  { enabled: false, route: "usb", pin: 5 },
);

{
  const storage = fakeStorage();
  writeDrawerSettings(storage, SCOPE, { enabled: false, route: "serial", pin: 5 });
  assert.deepEqual(readDrawerSettings(storage, SCOPE), { enabled: false, route: "serial", pin: 5 });
  assert.equal(storage.map.has(drawerSettingsStorageKey(SCOPE)), true);
  // A different till scope keeps the defaults — settings never leak.
  assert.deepEqual(readDrawerSettings(storage, `${ORG}:other-profile`), DEFAULT_DRAWER_SETTINGS);
}

// ---------------------------------------------------------------------------
// Trigger matrix — cash movement only, never card/credit (spec rules A/B).
// ---------------------------------------------------------------------------

assert.equal(drawerEventTypeForSale({ paymentType: "cash" }), "cash-sale");
assert.equal(drawerEventTypeForSale({ paymentType: "card" }), null);
assert.equal(drawerEventTypeForSale({ paymentType: "credit" }), null);
assert.equal(drawerEventTypeForSale({ paymentType: null }), null);
assert.equal(drawerEventTypeForSale({}), null);

assert.equal(drawerEventTypeForReturn({ linkedPaymentType: "cash" }), "cash-refund");
assert.equal(drawerEventTypeForReturn({ linkedPaymentType: "card" }), null);
assert.equal(drawerEventTypeForReturn({ linkedPaymentType: "credit" }), null);
// Unlinked return: no tender record — the counter default is cash back.
assert.equal(drawerEventTypeForReturn({ linkedPaymentType: null }), "cash-refund");
assert.equal(drawerEventTypeForReturn({}), "cash-refund");

// ---------------------------------------------------------------------------
// No Sale gate — owner/admin always; staff only with the owner setting;
// authoriser is recorded for permitted staff opens (spec rule D / Q2).
// ---------------------------------------------------------------------------

assert.equal(parseDrawerNoSaleStaffAllowed(true), true);
assert.equal(parseDrawerNoSaleStaffAllowed(false), false);
assert.equal(parseDrawerNoSaleStaffAllowed(undefined), false);
assert.equal(parseDrawerNoSaleStaffAllowed("true"), false);

assert.equal(noSaleOutcome({ role: "owner" }), "allowed");
assert.equal(noSaleOutcome({ role: "admin", staffAllowed: false }), "allowed");
assert.equal(noSaleOutcome({ role: "staff", staffAllowed: false }), "blocked");
assert.equal(noSaleOutcome({ role: "staff", staffAllowed: undefined }), "blocked");
assert.equal(noSaleOutcome({ role: "staff", staffAllowed: true }), "allowed");
assert.equal(noSaleOutcome({ role: null, staffAllowed: true }), "allowed");
assert.equal(noSaleOutcome({ role: "manager", staffAllowed: true }), "allowed");
assert.equal(noSaleOutcome({ role: "manager", staffAllowed: false }), "blocked");

// A reason is mandatory; "other" needs the free-text note.
assert.equal(isNoSaleReasonValid({ reasonCode: "making-change" }), true);
assert.equal(isNoSaleReasonValid({ reasonCode: "counting-drawer" }), true);
assert.equal(isNoSaleReasonValid({ reasonCode: "other" }), false);
assert.equal(isNoSaleReasonValid({ reasonCode: "other", reasonNote: "  " }), false);
assert.equal(isNoSaleReasonValid({ reasonCode: "other", reasonNote: "Fixing a jam" }), true);
assert.equal(isNoSaleReasonValid({ reasonCode: null }), false);
assert.equal(isNoSaleReasonValid({ reasonCode: "curiosity" }), false);

// ---------------------------------------------------------------------------
// Audit record shape per event type.
// ---------------------------------------------------------------------------

{
  const sale = buildDrawerEventRecord(baseEvent());
  assert.equal(sale.event_type, "cash-sale");
  assert.equal(sale.linked_sale_id, "sale-1");
  assert.equal(sale.amount, 1250);
  assert.equal(sale.route, "serial");
  assert.equal(sale.kick_pin, 2);
  assert.equal(sale.result, "sent");
  assert.equal(sale.error, null);
  // Automatic events carry no reason and no separate authoriser.
  assert.equal(sale.reason_code, null);
  assert.equal(sale.authorised_by_profile_id, null);

  const noSale = buildDrawerEventRecord(baseEvent({
    eventType: "no-sale",
    linkedSaleId: null,
    amount: null,
    reasonCode: "making-change",
  }));
  assert.equal(noSale.event_type, "no-sale");
  assert.equal(noSale.reason_code, "making-change");
  // The permitted actor is the authoriser of record for a manual open.
  assert.equal(noSale.authorised_by_profile_id, PROFILE);

  const refund = buildDrawerEventRecord(baseEvent({ eventType: "cash-refund", amount: 300 }));
  assert.equal(refund.event_type, "cash-refund");
  assert.equal(refund.amount, 300);

  const failed = buildDrawerEventRecord(baseEvent({ result: "failed", error: "no-serial-port" }));
  assert.equal(failed.result, "failed");
  assert.equal(failed.error, "no-serial-port");
}

// ---------------------------------------------------------------------------
// Kick orchestration — fire-and-forget, bounded, always recorded.
// ---------------------------------------------------------------------------

function recordingTransports(overrides: Partial<DrawerTransports> = {}) {
  const calls: string[] = [];
  const transports: DrawerTransports = {
    print: async () => { calls.push("print"); },
    serial: async (bytes) => { calls.push(`serial:${[...bytes].join(",")}`); },
    usb: async () => { calls.push("usb"); },
    ...overrides,
  };
  return { transports, calls };
}

async function runKickTests() {
  // Cash sale over serial: bytes written, outcome sent, event recorded.
  {
    const { transports, calls } = recordingTransports();
    const recorded: DrawerEventRecord[] = [];
    const outcome = await kickDrawer(
      { settings: { enabled: true, route: "serial", pin: 5 }, event: baseEvent() },
      { transports, record: async (row) => { recorded.push(row); } },
    );
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.result, "sent");
    assert.deepEqual(calls, ["serial:27,112,1,25,250"]);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].kick_pin, 5);
  }

  // Print route: no bytes — the kick rides the receipt print job.
  {
    const { transports, calls } = recordingTransports();
    const outcome = await kickDrawer(
      { settings: { enabled: true, route: "print", pin: 2 }, event: baseEvent() },
      { transports, record: async () => {} },
    );
    assert.equal(outcome.result, "sent");
    assert.deepEqual(calls, ["print"]);
  }

  // Transport failure: resolves as a recorded failure, never throws.
  {
    const { transports } = recordingTransports({
      serial: async () => { throw new Error("no-serial-port"); },
    });
    const recorded: DrawerEventRecord[] = [];
    const outcome = await kickDrawer(
      { settings: { enabled: true, route: "serial", pin: 2 }, event: baseEvent() },
      { transports, record: async (row) => { recorded.push(row); } },
    );
    assert.equal(outcome.result, "failed");
    assert.equal(outcome.error, "no-serial-port");
    assert.equal(recorded[0].result, "failed");
    assert.equal(recorded[0].error, "no-serial-port");
  }

  // A stuck transport is bounded by the timeout — the sale never waits.
  {
    const { transports } = recordingTransports({
      usb: () => new Promise<void>(() => {}),
    });
    const outcome = await kickDrawer(
      { settings: { enabled: true, route: "usb", pin: 2 }, event: baseEvent() },
      { transports, record: async () => {}, timeoutMs: 25 },
    );
    assert.equal(outcome.result, "failed");
    assert.equal(outcome.error, "drawer-timeout");
  }

  // Disabled till + automatic event: skipped silently (no log spam).
  {
    const { transports, calls } = recordingTransports();
    const recorded: DrawerEventRecord[] = [];
    const outcome = await kickDrawer(
      { settings: { enabled: false, route: "serial", pin: 2 }, event: baseEvent() },
      { transports, record: async (row) => { recorded.push(row); } },
    );
    assert.equal(outcome.attempted, false);
    assert.equal(recorded.length, 0);
    assert.deepEqual(calls, []);
  }

  // Disabled till + No Sale attempt: attempted and recorded as failed —
  // a manual open attempt is audit-worthy even when it cannot fire.
  {
    const { transports } = recordingTransports();
    const recorded: DrawerEventRecord[] = [];
    const outcome = await kickDrawer(
      {
        settings: { enabled: false, route: "serial", pin: 2 },
        event: baseEvent({ eventType: "no-sale", linkedSaleId: null, amount: null, reasonCode: "counting-drawer" }),
      },
      { transports, record: async (row) => { recorded.push(row); } },
    );
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.result, "failed");
    assert.equal(outcome.error, "drawer-disabled");
    assert.equal(recorded[0].event_type, "no-sale");
  }

  // A throwing recorder cannot break the kick outcome either.
  {
    const { transports } = recordingTransports();
    const outcome = await kickDrawer(
      { settings: { enabled: true, route: "serial", pin: 2 }, event: baseEvent() },
      { transports, record: async () => { throw new Error("db down"); } },
    );
    assert.equal(outcome.result, "sent");
  }
}

// ---------------------------------------------------------------------------
// Outbox — pre-migration resilience: failed inserts queue locally and
// flush when the table appears; nothing is lost silently.
// ---------------------------------------------------------------------------

async function runOutboxTests() {
  const failingInsert: DrawerEventInsert = {
    insert: async () => ({ error: { code: "42P01", message: "relation drawer_events does not exist" } }),
  };
  const okInsert: DrawerEventInsert = { insert: async () => ({ error: null }) };

  const storage = fakeStorage();
  const record = createDrawerEventRecorder({ insert: failingInsert, storage });
  const row = buildDrawerEventRecord(baseEvent());
  await record(row);
  const queued = readDrawerOutbox(storage, ORG);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].event_type, "cash-sale");
  assert.equal(storage.map.has(drawerOutboxStorageKey(ORG)), true);

  // Once the table exists, the queue drains.
  const remaining = await flushDrawerOutbox(okInsert, storage, ORG);
  assert.equal(remaining, 0);
  assert.equal(readDrawerOutbox(storage, ORG).length, 0);

  // A recorder whose insert now succeeds writes straight through.
  const recordOk = createDrawerEventRecorder({ insert: okInsert, storage });
  await recordOk(row);
  assert.equal(readDrawerOutbox(storage, ORG).length, 0);

  assert.deepEqual(parseDrawerOutbox("garbage"), []);
  assert.deepEqual(parseDrawerOutbox(null), []);
}

// ---------------------------------------------------------------------------
// Report helpers — filters and the no-sale exception count.
// ---------------------------------------------------------------------------

{
  const rows: DrawerEventRecord[] = [
    buildDrawerEventRecord(baseEvent({ eventType: "cash-sale" })),
    buildDrawerEventRecord(baseEvent({ eventType: "no-sale", linkedSaleId: null, amount: null, reasonCode: "making-change" })),
    buildDrawerEventRecord(baseEvent({ eventType: "test", linkedSaleId: null, amount: null })),
    buildDrawerEventRecord(baseEvent({ eventType: "no-sale", linkedSaleId: null, amount: null, reasonCode: "other", reasonNote: "Jam", result: "failed", error: "x" })),
  ];
  // Test opens never count as no-sales (spec D.11).
  assert.equal(countNoSaleEvents(rows), 2);
  assert.equal(filterDrawerEvents(rows, { eventType: "no-sale" }).length, 2);
  assert.equal(filterDrawerEvents(rows, { result: "failed" }).length, 1);
  assert.equal(filterDrawerEvents(rows, { eventType: "cash-sale", result: "sent" }).length, 1);
  assert.equal(filterDrawerEvents(rows, {}).length, 4);
}

void (async () => {
  await runKickTests();
  await runOutboxTests();
  console.log("test-cash-drawer: all assertions passed");
})();
