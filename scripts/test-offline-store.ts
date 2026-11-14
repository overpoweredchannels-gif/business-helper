import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import {
  loadOfflineCustomers,
  loadOfflineProducts,
  saveOfflineCustomers,
  saveOfflineProducts,
} from "../src/lib/offline/offline-store";

type Product = { id: string; name: string; price: number };
type Customer = { id: string; name: string; phone: string };

const SCOPE_A = "org-a:profile-a";
const SCOPE_B = "org-b:profile-b";

const productsA: Product[] = [
  { id: "p1", name: "DAIRY MILK", price: 9 },
  { id: "p2", name: "BOUNTY", price: 10 },
];
const customersA: Customer[] = [{ id: "c1", name: "AL FAZL", phone: "0300" }];

async function main(): Promise<void> {
  // 1. Empty cache loads empty, with no savedAt.
  assert.deepEqual(await loadOfflineProducts<Product>(SCOPE_A), { rows: [], savedAt: null }, "an empty product cache loads empty");
  assert.deepEqual(await loadOfflineCustomers<Customer>(SCOPE_A), { rows: [], savedAt: null }, "an empty customer cache loads empty");

  // 2. Save then load round-trips the exact rows, with a savedAt stamp.
  assert.equal(await saveOfflineProducts(SCOPE_A, productsA), true, "products save");
  const loadedProducts = await loadOfflineProducts<Product>(SCOPE_A);
  assert.deepEqual(loadedProducts.rows, productsA, "products round-trip exactly");
  assert.ok(loadedProducts.savedAt && !Number.isNaN(Date.parse(loadedProducts.savedAt)), "products carry a savedAt timestamp");

  assert.equal(await saveOfflineCustomers(SCOPE_A, customersA), true, "customers save");
  assert.deepEqual(
    (await loadOfflineCustomers<Customer>(SCOPE_A)).rows,
    customersA,
    "customers round-trip exactly",
  );

  // 3. Scopes are isolated: scope B sees nothing of scope A.
  assert.deepEqual(await loadOfflineProducts<Product>(SCOPE_B), { rows: [], savedAt: null }, "another scope sees no products");
  assert.deepEqual(await loadOfflineCustomers<Customer>(SCOPE_B), { rows: [], savedAt: null }, "another scope sees no customers");

  // 4. A newer save replaces the whole cache: a deleted row does not linger.
  const productsA2: Product[] = [{ id: "p2", name: "BOUNTY", price: 10 }];
  assert.equal(await saveOfflineProducts(SCOPE_A, productsA2), true, "products re-save");
  assert.deepEqual(
    (await loadOfflineProducts<Product>(SCOPE_A)).rows,
    productsA2,
    "the re-save replaced the cache instead of merging",
  );

  // 5. Products and customers are independent stores.
  assert.deepEqual(
    (await loadOfflineCustomers<Customer>(SCOPE_A)).rows,
    customersA,
    "re-saving products left the customer cache untouched",
  );

  // 6. Graceful degradation: with IndexedDB gone, saves fail soft and
  // loads come back empty instead of throwing.
  const realIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB;
  (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
  assert.equal(await saveOfflineProducts(SCOPE_A, productsA), false, "save without IndexedDB returns false");
  assert.deepEqual(
    await loadOfflineProducts<Product>(SCOPE_A),
    { rows: [], savedAt: null },
    "load without IndexedDB returns empty",
  );
  (globalThis as { indexedDB?: unknown }).indexedDB = realIndexedDB;

  console.log(
    "Offline store Phase E1 checks passed: empty-load, save/load round-trip with savedAt, per-scope isolation, whole-cache replace (no lingering deleted rows), independent product/customer stores, graceful degradation without IndexedDB.",
  );
}

void main();
