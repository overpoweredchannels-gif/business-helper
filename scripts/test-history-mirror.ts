/**
 * Slice S4 — Sales History + Inventory mirrors (Offline Tier-1).
 *
 * What this test proves, against the real SQLite store (not a mock):
 * 1. A whole fetch snapshot round-trips through the mirror per kind +
 *    scope, and a newer snapshot replaces the old one whole (a row
 *    deleted server-side does not linger offline).
 * 2. Mirrors are scope-isolated, and a corrupt mirror row is skipped on
 *    read instead of crashing it.
 * 3. A confirmed sale lands in the history mirror from
 *    `upsertConfirmedSaleMirror` (the S3 `afterSaleConfirmed` path),
 *    carrying its provisional number.
 * 4. A pending sale converts to a history row with its provisional
 *    L-number + pending id, its total matches the save math, and the
 *    merge drops the pending row once a synced row carries the same
 *    request_id or the same provisional number — one sale never renders
 *    twice.
 * 5. The web path is untouched: with no desktop bridge, the mirror
 *    backend is null and every mirror call is a no-op.
 *
 * Run with: npm run test:history-mirror
 * (tsx scripts/test-history-mirror.ts)
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, type MirrorKind } from "../electron/store";
import {
  loadHistoryMirror,
  saveHistoryMirror,
  upsertConfirmedSaleMirror,
} from "../src/lib/offline/history-mirror";
import {
  isPendingHistoryId,
  mergePendingHistory,
  pendingHistoryId,
  pendingSaleAmounts,
  pendingSaleToTransaction,
} from "../src/lib/sales/pending-history";
import type {
  AtomicSaleInput,
  AtomicSaleResult,
  PendingSale,
} from "../src/lib/sales/atomic-sale-client";

const SCOPE = "org-1:profile-1";
const OTHER_SCOPE = "org-1:profile-2";

const SALE_INPUT: AtomicSaleInput = {
  customer_id: "customer-1",
  sale_date: "2026-11-17",
  payment_type: "credit",
  invoice_discount: 0,
  invoice_discount_type: "flat",
  tax_rate: 0,
  cash_received: null,
  notes: null,
  credit_override_confirmed: false,
  lines: [
    {
      product_id: "product-1",
      quantity: 2,
      selling_price: 0.81,
      discount: 0,
      bonus: 0,
      unit_mode: "main",
    },
  ],
};

function pendingSale(
  requestId: string,
  overrides: Partial<PendingSale> = {},
): PendingSale {
  return {
    requestId,
    input: SALE_INPUT,
    provisionalNumber: "L-000123",
    createdAt: "2026-11-17T02:00:00.000Z",
    ...overrides,
  };
}

function installWindow(value: Record<string, unknown>): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value });
}

async function main(): Promise<void> {
  // 1. Mirror round-trip + whole-snapshot replace, via the SQLite store.
  const dir = mkdtempSync(join(tmpdir(), "aankh-s4-test-"));
  try {
    const store = createLocalStore(join(dir, "aankh.db"));

    // The renderer seam talks to the store through the preload bridge:
    // fake the window bridge with the real store behind it.
    installWindow({
      aankhDesktop: {
        isDesktop: true,
        mirror: {
          list: (kind: MirrorKind, scope: string) => Promise.resolve(store.listMirror(kind, scope)),
          replace: (kind: MirrorKind, scope: string, rows: Array<{ id: string; data: Record<string, unknown> }>) =>
            Promise.resolve(store.replaceMirror(kind, scope, rows)),
          upsert: (kind: MirrorKind, scope: string, row: { id: string; data: Record<string, unknown> }) =>
            Promise.resolve(store.upsertMirror(kind, scope, row)),
        },
      },
    });

    const txRow = {
      id: "tx-1",
      customer_id: "customer-1",
      invoice_number: "S-100099",
      created_at: "2026-11-17T00:13:00.000Z",
      sale_date: "2026-11-17",
      payment_type: "cash",
      total_amount: 1.13,
      request_id: "req-synced-1",
      provisional_receipt_number: "L-000120",
    };
    const itemRow = {
      id: "item-1",
      sales_transaction_id: "tx-1",
      product_id: "product-1",
      quantity: 1,
      selling_price: 1.13,
    };

    assert.equal(
      await saveHistoryMirror("sales_transaction", SCOPE, [txRow]),
      true,
      "a fetch snapshot writes to the mirror",
    );
    assert.equal(
      await saveHistoryMirror("sales_item", SCOPE, [itemRow]),
      true,
      "the items snapshot writes to the mirror",
    );
    const loaded = await loadHistoryMirror<typeof txRow>("sales_transaction", SCOPE);
    assert.deepEqual(loaded.rows, [txRow], "the mirror reads back the rows it was given");
    assert.equal(typeof loaded.savedAt, "string", "the mirror stamps the snapshot time");
    assert.ok(loaded.savedAt !== null && loaded.savedAt.length > 0, "the snapshot time is set");

    // A newer snapshot replaces the old one whole: a row gone from the
    // server does not linger offline.
    const txRow2 = { ...txRow, id: "tx-2", invoice_number: "S-100100" };
    await saveHistoryMirror("sales_transaction", SCOPE, [txRow2]);
    assert.deepEqual(
      (await loadHistoryMirror<typeof txRow>("sales_transaction", SCOPE)).rows,
      [txRow2],
      "a newer snapshot replaces the old rows whole",
    );

    // Scope isolation: another profile's mirror is a different snapshot.
    assert.deepEqual(
      (await loadHistoryMirror("sales_transaction", OTHER_SCOPE)).rows,
      [],
      "another scope reads an empty mirror",
    );
    assert.equal(
      (await loadHistoryMirror("sales_transaction", OTHER_SCOPE)).savedAt,
      null,
      "an empty mirror has no snapshot time",
    );

    // A corrupt mirror row is skipped on read, not fatal: a row whose
    // stored JSON is not a record fails the shape guard in rowToMirror
    // (the same path an unparseable JSON string takes).
    store.replaceMirror("product", SCOPE, [
      { id: "product-1", data: { id: "product-1", name: "COCA COLA 1L", current_stock: 74 } },
      { id: "product-bad", data: "not-a-record" as unknown as Record<string, unknown> },
    ]);
    const products = await loadHistoryMirror<{ id: string; name: string }>("product", SCOPE);
    assert.equal(products.rows.length, 1, "a corrupt mirror row is skipped on read");
    assert.equal(products.rows[0].id, "product-1", "the good row still reads back");

    // 2. A confirmed sale lands in the history mirror from the
    // afterSaleConfirmed path, with its provisional number attached.
    const confirmed: AtomicSaleResult = {
      transaction: {
        id: "tx-3",
        customer_id: "customer-1",
        invoice_number: "S-100101",
        created_at: "2026-11-17T02:05:00.000Z",
        sale_date: "2026-11-17",
        payment_type: "cash",
        total_amount: 1.62,
        request_id: "req-3",
      },
      customer_name: "QA Shop",
      items: [
        {
          id: "item-3",
          sales_transaction_id: "tx-3",
          product_id: "product-1",
          quantity: 2,
          selling_price: 0.81,
        },
      ],
      replayed: false,
    };
    await upsertConfirmedSaleMirror(SCOPE, pendingSale("req-3", { provisionalNumber: "L-000124" }), confirmed);
    const mirroredTx = await loadHistoryMirror<typeof txRow>("sales_transaction", SCOPE);
    const confirmedRow = mirroredTx.rows.find((row) => row.id === "tx-3");
    assert.ok(confirmedRow, "the confirmed sale is in the history mirror");
    assert.equal(
      confirmedRow.provisional_receipt_number,
      "L-000124",
      "the confirmed row carries its provisional number",
    );
    const mirroredItems = await loadHistoryMirror<typeof itemRow>("sales_item", SCOPE);
    assert.equal(
      mirroredItems.rows.some((row) => row.id === "item-3"),
      true,
      "the confirmed sale's items are in the mirror too",
    );

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 3. Pending history: conversion, totals, merge + dedupe (pure
  //    helpers — no store needed).
  const pending = pendingSale("req-9");
  const amounts = pendingSaleAmounts(pending.input);
  assert.equal(amounts.total, 1.62, "the pending total matches the save math (2 x 0.81)");
  const tx = pendingSaleToTransaction(pending, "Pending sync");
  assert.ok(tx, "a queued sale converts to a history row");
  assert.equal(tx.invoice_number, "L-000123", "the pending row shows its provisional number");
  assert.equal(tx.id, pendingHistoryId("req-9"), "the pending row id is synthetic");
  assert.equal(isPendingHistoryId(tx.id), true, "the pending id is recognisable as pending");
  assert.equal(isPendingHistoryId("tx-1"), false, "a server row id is not pending");
  assert.equal(tx.created_at, "2026-11-17T02:00:00.000Z", "the pending row time is its first-queued time");
  assert.equal(tx.total_amount, 1.62, "the pending row total matches the save math");
  assert.equal(tx.payment_type, "credit", "the pending row keeps its payment type");

  const noNumber = pendingSale("req-10", { provisionalNumber: undefined, createdAt: undefined });
  const fallbackTx = pendingSaleToTransaction(noNumber, "Pending sync");
  assert.equal(fallbackTx?.invoice_number, "Pending sync", "no provisional number falls back to the label");
  assert.equal(
    fallbackTx?.created_at,
    "2026-11-17T00:00:00",
    "no queued time falls back to the sale date",
  );
  assert.equal(
    pendingSaleToTransaction({ requestId: "req-11", input: { ...SALE_INPUT, lines: [] } }),
    null,
    "a sale with no lines converts to nothing",
  );

  const syncedTx = {
    id: "tx-1",
    customer_id: "customer-1",
    invoice_number: "S-100099",
    created_at: "2026-11-17T00:13:00.000Z",
    sale_date: "2026-11-17",
    payment_type: "cash",
    total_amount: 1.13,
    request_id: "req-synced-1",
    provisional_receipt_number: "L-000120",
  } as unknown as Parameters<typeof mergePendingHistory>[0][number];
  const syncedItems = [
    {
      id: "item-1",
      sales_transaction_id: "tx-1",
      product_id: "product-1",
      quantity: 1,
      selling_price: 1.13,
    },
  ];

  // The pending sale appears before the synced rows.
  const merged = mergePendingHistory([syncedTx], syncedItems, [pending]);
  assert.deepEqual(
    merged.transactions.map((row) => row.id),
    [pendingHistoryId("req-9"), "tx-1"],
    "the pending sale appears with the synced rows",
  );
  assert.equal(
    merged.items.some((item) => String(item.sales_transaction_id) === pendingHistoryId("req-9")),
    true,
    "the pending sale's items appear in the merged items",
  );

  // Dedupe by request_id: the same sale, now synced, drops its pending twin.
  const syncedTwin = {
    ...syncedTx,
    id: "tx-9",
    invoice_number: "S-100102",
    request_id: "req-9",
  } as unknown as Parameters<typeof mergePendingHistory>[0][number];
  const mergedByRequestId = mergePendingHistory([syncedTwin, syncedTx], syncedItems, [pending]);
  assert.deepEqual(
    mergedByRequestId.transactions.map((row) => row.id),
    ["tx-9", "tx-1"],
    "a synced row with the same request_id drops the pending twin",
  );

  // Dedupe by provisional number: the same sale, now synced under a
  // server number, drops its pending twin even when the request_id is
  // not on the row (older rows fetched before the select change).
  const syncedByNumber = {
    ...syncedTx,
    id: "tx-9",
    invoice_number: "S-100102",
    request_id: null,
    provisional_receipt_number: "L-000123",
  } as unknown as Parameters<typeof mergePendingHistory>[0][number];
  const mergedByNumber = mergePendingHistory([syncedByNumber, syncedTx], syncedItems, [pending]);
  assert.deepEqual(
    mergedByNumber.transactions.map((row) => row.id),
    ["tx-9", "tx-1"],
    "a synced row with the same provisional number drops the pending twin",
  );

  // 4. Web path untouched: no desktop bridge, no mirror backend.
  installWindow({});
  assert.equal(
    await saveHistoryMirror("sales_transaction", SCOPE, []),
    false,
    "without a desktop bridge the mirror write is a no-op",
  );
  assert.deepEqual(
    await loadHistoryMirror("sales_transaction", SCOPE),
    { rows: [], savedAt: null },
    "without a desktop bridge the mirror read is empty",
  );
}

main()
  .then(() => {
    console.log("test-history-mirror: all assertions passed");
  })
  .catch((error) => {
    console.error("test-history-mirror failed:", error);
    process.exitCode = 1;
  });
