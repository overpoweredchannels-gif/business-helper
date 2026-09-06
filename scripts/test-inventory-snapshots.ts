import assert from "node:assert/strict";
import { buildInventorySnapshots } from "../src/lib/inventory/service";
import { allPages } from "../src/lib/supabase/all-pages";
import type { InventoryTransaction } from "../src/lib/inventory/types";

async function main() {
  const movement = { product_id: 1, quantity_delta: 5, created_at: "2026-09-06" } as InventoryTransaction;
  for (const quantity of [131, 140, 131140]) {
    for (const transactions of [[], [movement]]) {
      const [snapshot] = buildInventorySnapshots([{ id: 1, name: "Imported product", currentStock: quantity, reorderLevel: 10 }], transactions);
      assert.equal(snapshot.currentStock, quantity);
      assert.equal(snapshot.status, "healthy", "Missing/partial movement history must not mark positive saved stock as out of stock");
    }
  }
  const [zero] = buildInventorySnapshots([{ id: 1, name: "Sold out", currentStock: 0, reorderLevel: 10 }], [movement]);
  assert.equal(zero.status, "out_of_stock", "Explicit zero must not fall back to historical receipts");
  const [low] = buildInventorySnapshots([{ id: 1, name: "Low", currentStock: 2, reorderLevel: 10 }], []);
  assert.equal(low.status, "urgent_reorder");
  assert.equal(buildInventorySnapshots([{ id: 1, name: "Legacy" }], [movement])[0].currentStock, 5);
  const all = Array.from({ length: 1140 }, (_, id) => ({ id }));
  const result = await allPages(async (from, to) => ({ data: all.slice(from, to + 1), error: null }));
  assert.deepEqual(result.data, all);
  const failed = await allPages(async from => from ? { data: null, error: { message: "Network error" } } : { data: all.slice(0, 500), error: null });
  assert.equal(failed.data, null, "Do not present a partial list as a successful full read");
  console.log("Inventory saved balances, zero/low stock, partial ledger and complete paginated lists passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
