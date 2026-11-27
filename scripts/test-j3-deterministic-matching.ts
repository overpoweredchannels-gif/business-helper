import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { liveEntityContext, loadLiveEntityRows } from "../src/lib/ai/live-entity-context";
import { todayInTimezone } from "../src/lib/ai/confirmation-content";
import {
  describeLiveMatch, MATCH_LIMIT, MATCH_THRESHOLD, RESOLVE_THRESHOLD, resolveLiveCandidate,
  searchCustomersLive, searchEmployeesLive, searchProductsLive, searchSuppliersLive,
} from "../src/lib/ai/entity-match";

// Aylo's literal substring scores 0.9, its one-letter typo scores 0.8.
// Two Fanta matches clear 0.5, so neither is automatically selected.
// Suggestions use 0.3 and up to three rows. Zqx has no plausible match.
const products = [
  { id: "aylo", name: "Aylo 2000 ml 🥭", is_active: true, default_selling_price: 6.15, current_stock: 10 },
  { id: "pepsi", name: "Pepsi 500ml", is_active: true, default_selling_price: 1.20, current_stock: 40 },
  { id: "fanta-small", name: "Fanta 500ml", is_active: true, default_selling_price: 1.10, current_stock: 2 },
  { id: "fanta-large", name: "Fanta 1L", is_active: true, default_selling_price: 2.00, current_stock: 12 },
  { id: "inactive", name: "Test Inactive Drink", is_active: false, default_selling_price: 5, current_stock: 0 },
  { id: "urdu", name: "آلو", is_active: true, default_selling_price: 1, current_stock: 4 },
];
const customers = [
  { id: "walk", customer_name: "Walk-in", credit_policy: "cash_only" },
  { id: "hamza", customer_name: "CHAUDHRY HAMZA ABID" },
  { id: "noor", customer_name: "Al Noor Traders" },
];
assert.deepEqual([MATCH_THRESHOLD, RESOLVE_THRESHOLD, MATCH_LIMIT], [0.3, 0.5, 3]);
const aylo = searchProductsLive("Aylo 2000 ml", products);
assert.deepEqual(aylo[0], {
  id: "aylo", name: "Aylo 2000 ml 🥭", status: "active", score: 0.9,
  matchedField: "name", defaultSellingPrice: 6.15, currentStock: 10,
});
assert.equal(resolveLiveCandidate(aylo)?.id, "aylo");
assert.equal(searchProductsLive("Ailo 2000 ml", products)[0]?.score, 0.8);
assert.equal(searchProductsLive("Pepsi 500 m.l", products)[0]?.id, "pepsi");
assert.equal(searchProductsLive("الو", products)[0]?.score, 1);
const fanta = searchProductsLive("Fanta", products);
assert.deepEqual(fanta.map((row) => row.id), ["fanta-large", "fanta-small"]);
assert.deepEqual(searchProductsLive("Fanta", [...products].reverse()), fanta);
assert.equal(resolveLiveCandidate(fanta), null);
assert.match(describeLiveMatch("product", "Fanta", fanta), /Which product.*Fanta 1L.*Fanta 500ml/);
const absent = searchProductsLive("Zqx 999", products);
assert.deepEqual(absent, []);
assert.match(describeLiveMatch("product", "Zqx 999", absent), /live search did not find/);
assert.doesNotMatch(describeLiveMatch("product", "Zqx 999", null), /did not find/);
const inactive = searchProductsLive("Test Inactive Drink", products);
assert.equal(inactive[0]?.status, "inactive");
assert.equal(resolveLiveCandidate(inactive), null);
assert.match(describeLiveMatch("product", "Test Inactive Drink", inactive), /is inactive/);
for (const name of ["Walk-in", "Walk-in customer"]) {
  const walk = resolveLiveCandidate(searchCustomersLive(name, customers));
  assert.equal(walk?.id, "walk");
  assert.equal(walk?.creditPolicy, "cash_only");
}
assert.equal(resolveLiveCandidate(searchCustomersLive("Al Noor Traders", customers))?.id, "noor");
const noor = searchCustomersLive("Al Noor", customers);
assert.equal(noor[0]?.id, "noor");
// The existing overlap scorer treats "al" as a substring of "walk".
// Both clear 0.5, so the short query asks rather than selecting Noor.
assert.deepEqual(noor.map((row) => row.score), [0.9, 0.65]);
assert.equal(resolveLiveCandidate(noor), null);
assert.deepEqual(searchCustomersLive("Zqx Stores", customers), []);
assert.equal(searchSuppliersLive("Acme", [{ id: "supplier", supplier_name: "Acme Wholesale" }])[0]?.id, "supplier");
assert.equal(searchEmployeesLive("Ali", [{ id: "staff", display_name: "Ali" }])[0]?.id, "staff");
const initialCatalogue = products.filter((row) => row.id !== "aylo");
assert.deepEqual(searchProductsLive("Aylo 2000 ml", initialCatalogue), []);
assert.equal(searchProductsLive("Aylo 2000 ml", products)[0]?.id, "aylo");

const chat = readFileSync("src/app/api/business-brain/route.ts", "utf8");
const query = readFileSync("src/app/api/ai-business-query/route.ts", "utf8");
const runtime = readFileSync("src/lib/ai/conversation-runtime.ts", "utf8");
const context = readFileSync("src/lib/ai/live-entity-context.ts", "utf8");
assert.match(chat, /liveEntityContext\(message, auth.actor.organizationId/);
assert.doesNotMatch(chat, /You have NO access to live data/);
assert.match(chat, /Never fabricate numbers/);
assert.match(query, /liveEntityContext\(question, permission.actor.organizationId/);
assert.match(runtime, /searchProductsLive\(name, catalog.products\)/);
assert.match(runtime, /searchCustomersLive\(name, catalog.customers\)/);
assert.match(runtime, /searchSuppliersLive\(name, catalog.suppliers\)/);
assert.match(runtime, /candidate\?\.status === "active"/);
assert.match(context, /const products = productRows \? searchProductsLive[\s\S]*?describeLiveMatch\("product", productName, products\)/);
for (const file of ["conversation-runtime", "inventory-intelligence", "customer-intelligence", "supplier-intelligence"]) {
  assert.doesNotMatch(readFileSync(`src/lib/ai/${file}.ts`, "utf8"), /store\??\.search(?:Products|Customers|Suppliers)/);
}

async function testLiveRead() {
  const requests: unknown[][] = [];
  const firstPage = Array.from({ length: 500 }, (_, index) => ({ id: index }));
  const builder = {
    select: (columns: string) => { requests.push(["select", columns]); return builder; },
    eq: (column: string, value: string) => { requests.push([column, value]); return builder; },
    order: (column: string) => { requests.push(["order", column]); return builder; },
    range: async (start: number, end: number) => {
      requests.push([start, end]);
      return { data: start === 0 ? firstPage : [products[0]], error: null };
    },
  };
  const supabase = { from: (table: string) => { requests.push(["table", table]); return builder; } } as unknown as SupabaseClient;
  const rows = await loadLiveEntityRows(supabase, "authenticated-org", "products", "id, name");
  assert.equal(rows?.length, 501);
  assert.deepEqual(rows?.at(-1), products[0]);
  assert.deepEqual(requests.filter(([key]) => key === "organization_id"), [
    ["organization_id", "authenticated-org"], ["organization_id", "authenticated-org"],
  ]);
}

async function testSaleContinuation() {
  const sale = "Create a sale: sell 1 Aylo 2000 ml to Walk-in customer, cash payment.";
  const classify = async (text: string) => text === sale
    ? { ok: true, intent: "create_sale" as const, language: "english", entities: {
      product_name: "Aylo 2000 ml", customer_name: "Walk-in customer", quantity: 1,
    } }
    : { ok: false, intent: "unknown" as const, language: "english", entities: {} };
  const walk = { id: "walk", customer_name: "Walk-in customer", credit_policy: "cash_only" };
  const competing = { id: "other", customer_name: "AL FAZL" };
  const client = (ambiguous = true) => ({
    from(table: string) {
      const builder = {
        select: () => builder,
        eq(column: string, value: string) {
          assert.equal(column, table === "organizations" ? "id" : "organization_id");
          assert.equal(value, "authenticated-org");
          return builder;
        },
        order: () => builder,
        range: async () => ({ data: table === "products" ? products : ambiguous ? [competing, walk] : [walk], error: null }),
        maybeSingle: async () => ({ data: { books_currency: "EUR", regional_preferences: { timeZone: "Asia/Karachi" } } }),
      };
      return builder;
    },
  }) as unknown as SupabaseClient;
  const expected = [
    "Sale confirmation preview",
    "Create Sale Invoice:",
    "• Customer: Walk-in customer",
    "• Product: Aylo 2000 ml 🥭",
    "• Quantity: 1",
    "• Selling Price: 6.15 EUR",
    "• Payment: cash",
    `• Invoice Date: ${todayInTimezone("Asia/Karachi")}`,
    "• Batch: —",
    "• Expiry: —",
    "Stock: 10. Open Sales to submit after reviewing.",
  ].join("\n");
  const first = await liveEntityContext(sale, "authenticated-org", "", true, [], classify, client);
  assert.equal(first.reply, "Which customer did you mean? 1. Walk-in customer; 2. AL FAZL");
  const history = [{ role: "user", text: sale }, { role: "assistant", text: first.reply }] as const;
  for (const answer of ["1", "Walk-in", "Walk-in customer"]) {
    const second = await liveEntityContext(answer, "authenticated-org", "", true, history, classify, client);
    assert.equal(second.reply, expected);
  }
  const invalid = await liveEntityContext("3", "authenticated-org", "", true, history, classify, client);
  assert.equal(invalid.reply, first.reply);
  const oneTurn = await liveEntityContext(sale, "authenticated-org", "", true, [], classify, () => client(false));
  assert.equal(oneTurn.reply, expected);
}

void testLiveRead().then(testSaleContinuation).then(() => console.log("J3 deterministic matching checks passed")).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
