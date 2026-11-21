// Sales-invoicing speed benchmark — MEASURE ONLY. No app code is changed,
// no deploy, no push. Two modes:
//
//   --mode local   (default)  SQLite offline save + web localStorage queue
//                             save + product search + print preparation.
//                             No network, no Supabase. Runs on this box.
//   --mode online            Seeds 5,000 products + 2,000 customers into the
//                             DISPOSABLE Supabase project, signs in as a fresh
//                             test owner, and measures the real online save
//                             (create_sales_invoice_atomic RPC, via the real
//                             createAtomicSale client path AND a raw RPC call).
//                             Cleans up every row + the test user afterwards.
//   --mode all     local + online.
//   --claimless    (online mode only) Run the online measurements as a
//                             CLAIM-LESS user (auth user + profile row, NO
//                             organization_id claim — the Step 4 gate) and
//                             compare against the claim baselines below.
//                             Fails (exit 1) if the claim-less median save
//                             is >20% slower than the matching claim median.
//                             Also measures a server-side product search
//                             (PostgREST, RLS applies) for the claim-less
//                             user AND for a claim user in the same org,
//                             and fails if the claim-less search median is
//                             >20% slower than the claim search median.
//
// Targets (UMAIR 2026-11-20): online save < 2s, offline save instant,
// product search instant, print < 1s. Test data: 5,000 products,
// 2,000 customers, 100-line invoice.
//
// Run with:  npx tsx scripts/bench-sales-invoicing-speed.ts [--mode local|online|all]
//            [--runs N] [--online-runs N] [--out results.json] [--claimless]
//
// Env (online mode only; never printed):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY or DISPOSABLE_SUPABASE_SERVICE_KEY
// (tsx does not load .env.local — export it first:
//  set -a; . ~/workspace/tradeos-localization/.env.local; set +a)
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkCatalog, type SynthProduct } from "./fixtures/product-search-catalog";
import { rankSearchResults } from "../src/lib/products/search-rank";
import { createLocalStore, type LocalSaleRow } from "../electron/store";
import {
  LocalStorageSaleQueueBackend,
} from "../src/lib/offline/local-store";
import {
  createAtomicSale,
  type AtomicSaleInput,
  type PendingSale,
} from "../src/lib/sales/atomic-sale-client";
import {
  buildOfflineSaleReceipt,
  buildPrintableReceiptHtml,
} from "../src/lib/print/retail-receipt";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";

// ---------------------------------------------------------------------------
// Config + stats
// ---------------------------------------------------------------------------
const PRODUCT_COUNT = 5000;
const CUSTOMER_COUNT = 2000;
const INVOICE_LINES = 100;
const SCOPE = "bench-org:bench-profile";

type Stats = { n: number; min: number; median: number; p95: number; p99: number; max: number; mean: number };
function stats(timesMs: number[]): Stats {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { n: sorted.length, min: sorted[0], median: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1], mean: +mean.toFixed(3) };
}
function fmt(s: Stats): string {
  return `n=${s.n} min=${s.min.toFixed(2)}ms median=${s.median.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms p99=${s.p99.toFixed(2)}ms max=${s.max.toFixed(2)}ms mean=${s.mean.toFixed(2)}ms`;
}
function timeSync<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}
async function timeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([a-z-]+)(?:=(.+))?$/);
  if (m) args.set(m[1], m[2] ?? process.argv[++i] ?? "true");
}
const mode = args.get("mode") ?? "local";
const runs = Number(args.get("runs") ?? 50);
const onlineRuns = Number(args.get("online-runs") ?? 5);
const outPath = args.get("out") ?? null;
// Bare flag only (--claimless); --claimless=false would still count as set.
const claimless = process.argv.includes("--claimless");
if (claimless && mode === "local") {
  console.log("note: --claimless applies to online mode only — local measurements (SQLite, localStorage, in-memory search) are claim-independent, so they run unchanged.");
}

// Claim baselines for the --claimless gate — bench run #4 (44801788044,
// main e3cc120, verified): raw RPC median 753.32ms, client-path median
// 743.06ms (100-line invoice, 5,000 products / 2,000 customers, n=5).
// The claim-less gate fails if the claim-less median save is more than
// 20% slower than the matching claim median.
const CLAIM_BASELINE_RPC_MEDIAN_MS = 753.32;
const CLAIM_BASELINE_CLIENT_MEDIAN_MS = 743.06;
const CLAIMLESS_SLOWDOWN_LIMIT = 1.2;
if (!["local", "online", "all"].includes(mode)) {
  console.error(`Unknown --mode ${JSON.stringify(mode)} (local|online|all)`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
console.log(`=== Seed (in-memory): ${PRODUCT_COUNT} products, ${CUSTOMER_COUNT} customers, ${INVOICE_LINES}-line invoice ===`);
const seedStart = performance.now();
const catalog: SynthProduct[] = mkCatalog(PRODUCT_COUNT);
const customers = Array.from({ length: CUSTOMER_COUNT }, (_, i) => ({
  id: `c-bench-${String(i + 1).padStart(4, "0")}`,
  name: `Bench Customer ${String(i + 1).padStart(4, "0")}`,
}));
const productById = new Map(catalog.map((p) => [p.id, p]));
const saleDate = new Date().toISOString().slice(0, 10);

/** A 100-line cash invoice over the first 100 catalog products. Prices are
 * the catalog's own 2-decimal selling prices, so the input is exactly what
 * the POS form would build (qty 1, no discount, no bonus). */
function buildSaleInput(productIds: string[], customerId: string): AtomicSaleInput {
  const lines = productIds.slice(0, INVOICE_LINES).map((id) => {
    const p = productById.get(id);
    const price = Math.round(Number(p?.default_selling_price ?? 100) * 100) / 100;
    return { product_id: id, quantity: 1, selling_price: price, discount: 0, bonus: 0, unit_mode: "main" as const };
  });
  const total = Math.round(lines.reduce((sum, l) => sum + l.quantity * l.selling_price, 0) * 100) / 100;
  return {
    customer_id: customerId,
    sale_date: saleDate,
    payment_type: "cash",
    invoice_discount: 0,
    invoice_discount_type: "flat",
    tax_rate: 0,
    cash_received: total,
    notes: null,
    credit_override_confirmed: false,
    lines,
  };
}
const localInput = buildSaleInput(catalog.map((p) => p.id), customers[0].id);
console.log(`seed built in ${(performance.now() - seedStart).toFixed(1)}ms; invoice total=${localInput.cash_received}`);

const results: Record<string, unknown> = {
  mode,
  testData: { products: PRODUCT_COUNT, customers: CUSTOMER_COUNT, invoiceLines: INVOICE_LINES },
  targets: { onlineSaveMs: 2000, offlineSave: "instant", productSearch: "instant", printMs: 1000 },
  commit: process.env.BENCH_COMMIT ?? null,
};

// ---------------------------------------------------------------------------
// LOCAL MODE
// ---------------------------------------------------------------------------
async function runLocal(): Promise<void> {
  console.log("\n=== LOCAL: offline save (SQLite, desktop queue) ===");
  const dir = mkdtempSync(join(tmpdir(), "bench-aankh-"));
  const store = createLocalStore(join(dir, "bench.db"));
  try {
    const row = (requestId: string): LocalSaleRow => ({
      requestId,
      input: localInput as unknown as Record<string, unknown>,
      provisionalNumber: null,
      createdAt: null,
    });
    // Case A: fresh queue (1 row) — the first sale of the day.
    const freshTimes: number[] = [];
    for (let i = 0; i < runs; i++) {
      store.replaceSales(SCOPE, []);
      freshTimes.push((await timeAsync(() => Promise.resolve(store.replaceSales(SCOPE, [row(randomUUID())])))).ms);
    }
    const fresh = stats(freshTimes);
    console.log(`  replaceSales, 1-row queue : ${fmt(fresh)}`);
    // Case B: busy queue (25 waiting + the new one) — replace rewrites the
    // whole scope queue, so cost grows with queue depth; this is the
    // end-of-day shape.
    const busyTimes: number[] = [];
    for (let i = 0; i < runs; i++) {
      const waiting = Array.from({ length: 25 }, () => row(randomUUID()));
      store.replaceSales(SCOPE, waiting);
      busyTimes.push((await timeAsync(() => Promise.resolve(store.replaceSales(SCOPE, [...waiting, row(randomUUID())])))).ms);
    }
    const busy = stats(busyTimes);
    console.log(`  replaceSales, 26-row queue: ${fmt(busy)}`);
    // Queue read-back (every save reads the queue first).
    const readTimes: number[] = [];
    for (let i = 0; i < runs; i++) {
      readTimes.push(timeSync(() => store.listSales(SCOPE)).ms);
    }
    console.log(`  listSales read-back (26 rows): ${fmt(stats(readTimes))}`);
    results.offlineSaveSqlite = { freshQueue1RowMs: fresh, busyQueue26RowsMs: busy, listSalesMs: stats(readTimes) };
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("\n=== LOCAL: offline save (web localStorage queue) ===");
  // The web backend reads window.localStorage at call time; polyfill it
  // with a Map so the real LocalStorageSaleQueueBackend runs in Node.
  const mem = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    },
    dispatchEvent: () => true,
  };
  const webBackend = new LocalStorageSaleQueueBackend();
  const pending = (requestId: string): PendingSale => ({ requestId, input: localInput });
  const webTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    await webBackend.replace(SCOPE, []);
    webTimes.push((await timeAsync(() => webBackend.replace(SCOPE, [pending(randomUUID())]))).ms);
  }
  console.log(`  replace, 1-row queue: ${fmt(stats(webTimes))}`);
  results.offlineSaveWebLocalStorage = { queue1RowMs: stats(webTimes) };

  console.log("\n=== LOCAL: offline save end-to-end (createAtomicSale, dead network) ===");
  // The user-perceived offline save on web: queue write + the RPC attempt
  // failing fast (connection refused) + the status re-check failing fast.
  // The dead-end client points at a closed loopback port so the failure is
  // immediate; no_proxy keeps the sandbox proxy out of the way.
  process.env.NO_PROXY = "127.0.0.1,localhost";
  process.env.no_proxy = "127.0.0.1,localhost";
  const deadClient = createClient("http://127.0.0.1:9", "bench-dead-end-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Parameters<typeof createAtomicSale>[0];
  const e2eTimes: number[] = [];
  let queued = 0;
  for (let i = 0; i < 10; i++) {
    const { result, ms } = await timeAsync(() => createAtomicSale(deadClient, SCOPE, buildSaleInput(catalog.map((p) => p.id), customers[0].id)));
    e2eTimes.push(ms);
    if ("queued" in result) queued += 1;
  }
  console.log(`  createAtomicSale offline: ${fmt(stats(e2eTimes))} (queued ${queued}/10)`);
  results.offlineSaveEndToEndWeb = { ms: stats(e2eTimes), queued };
  // Clean the polyfilled queue so a later online run in --mode all starts clean.
  await webBackend.replace(SCOPE, []);

  console.log("\n=== LOCAL: product search (rankSearchResults over 5,000 SKUs) ===");
  const fieldsOf = (p: SynthProduct) => ({
    name: p.name, sku: p.sku, barcode: p.barcode, brandName: p.brand, categoryName: p.category,
  });
  const queries = ["shampoo", "Hey", "SKU-0042", "8961000100028", "Sufi Cooking Oil 5L", "S"];
  const searchOut: Record<string, unknown> = {};
  for (const q of queries) {
    // Cold first run (no warmup) is what a cashier feels after a fresh load.
    const cold = timeSync(() => rankSearchResults(catalog, q, fieldsOf)).ms;
    for (let i = 0; i < 20; i++) rankSearchResults(catalog, q, fieldsOf); // warmup
    const times: number[] = [];
    for (let i = 0; i < 100; i++) times.push(timeSync(() => rankSearchResults(catalog, q, fieldsOf)).ms);
    const s = stats(times);
    const top = rankSearchResults(catalog, q, fieldsOf)[0]?.name ?? null;
    console.log(`  query=${JSON.stringify(q)} cold=${cold.toFixed(2)}ms ${fmt(s)} top=${JSON.stringify(top)}`);
    searchOut[q] = { coldMs: +cold.toFixed(2), ...s, topResult: top };
  }
  results.productSearch = searchOut;

  console.log("\n=== LOCAL: print preparation (100-line receipt) ===");
  const template = cloneDefaultTemplate("retail_receipt");
  const receiptTimes: number[] = [];
  const htmlTimes: number[] = [];
  let htmlBytes = 0;
  for (let i = 0; i < runs; i++) {
    const { result: receipt, ms: rMs } = timeSync(() =>
      buildOfflineSaleReceipt(localInput, {
        scope: SCOPE,
        business: "Bench Shop",
        pendingLabel: "Pending sync",
        provisionalNumber: "L-000123",
        customerName: customers[0].name,
        footerNote: "",
        paymentTerms: "Due on receipt",
        productById: (id) => {
          const p = productById.get(id);
          return p ? { name: p.name, unit_type: p.unit_type, subunit_type: p.subunit_type ?? null } : undefined;
        },
      }),
    );
    receiptTimes.push(rMs);
    const { result: html, ms: hMs } = timeSync(() => buildPrintableReceiptHtml(receipt, template));
    htmlTimes.push(hMs);
    htmlBytes = Buffer.byteLength(html, "utf8");
  }
  console.log(`  buildOfflineSaleReceipt: ${fmt(stats(receiptTimes))}`);
  console.log(`  buildPrintableReceiptHtml: ${fmt(stats(htmlTimes))} (HTML ${(htmlBytes / 1024).toFixed(1)} KB)`);
  console.log("  NOTE: the native print dialog is OS-controlled and cannot be measured in a script; this is the in-app preparation cost before dispatch.");
  results.printPreparation = {
    buildReceiptMs: stats(receiptTimes),
    buildHtmlMs: stats(htmlTimes),
    htmlBytes,
    note: "Native print dialog excluded (OS-controlled).",
  };
}

// ---------------------------------------------------------------------------
// ONLINE MODE (CI / disposable project)
//
// In --claimless mode the test owner is created WITHOUT an organization_id
// claim (same direct createUser + org + profile as claim mode — provision
// is never called, it would write the claim). The save RPC resolves the
// org from the profile row directly (SECURITY DEFINER, profiles lookup),
// so the save comparison is a weak gate by construction; the STRONG gate
// is the server-side product search below, whose RLS policies evaluate
// current_org_id() — claim read vs Step 4 fallback profile lookup.
// ---------------------------------------------------------------------------
async function runOnline(claimlessMode: boolean): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.DISPOSABLE_SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Online mode needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
      "DISPOSABLE_SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY). " +
      `Have: url=${Boolean(url)}, anon=${Boolean(anonKey)}, service=${Boolean(serviceKey)}. ` +
      "The service key is never printed.",
    );
  }
  const stamp = Date.now().toString(36);
  const email = `bench-${stamp}@bench.local`;
  // One UUID (36 chars) — two UUIDs joined are 73 chars and bcrypt
  // rejects passwords over 72 chars (CI run 44795179725).
  const password = randomUUID();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = { userId: "", orgId: "", productIds: [] as string[], customerIds: [] as string[], saleIds: [] as string[], extraUserIds: [] as string[] };

  const cleanup = async () => {
    const report: string[] = [];
    try {
      if (created.saleIds.length) {
        await admin.from("sales_items").delete().in("sales_transaction_id", created.saleIds);
        const { error } = await admin.from("sales_transactions").delete().in("id", created.saleIds);
        report.push(`sales=${created.saleIds.length}${error ? ` (delete error: ${error.message})` : ""}`);
      }
      for (let i = 0; i < created.productIds.length; i += 500) {
        await admin.from("products").delete().in("id", created.productIds.slice(i, i + 500));
      }
      if (created.productIds.length) report.push(`products=${created.productIds.length}`);
      for (let i = 0; i < created.customerIds.length; i += 500) {
        await admin.from("customers").delete().in("id", created.customerIds.slice(i, i + 500));
      }
      if (created.customerIds.length) report.push(`customers=${created.customerIds.length}`);
      const allUserIds = [created.userId, ...created.extraUserIds].filter(Boolean);
      for (const uid of allUserIds) {
        await admin.from("profiles").delete().eq("id", uid);
      }
      if (allUserIds.length) report.push(`profiles=${allUserIds.length}`);
      if (created.orgId) {
        await admin.from("organizations").delete().eq("id", created.orgId);
        report.push("org=1");
      }
      for (const uid of allUserIds) {
        const { error } = await admin.auth.admin.deleteUser(uid);
        if (error) report.push(`auth-user ${uid} delete error: ${error.message}`);
      }
      if (allUserIds.length) report.push(`auth-users=${allUserIds.length}`);
    } catch (e) {
      report.push(`cleanup threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log(`  cleanup: ${report.join(", ") || "nothing to clean"}`);
  };

  try {
    console.log("\n=== ONLINE: seed disposable project (service key) ===");
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (userError || !userData.user) throw new Error(`createUser failed: ${userError?.message ?? "no user returned"}`);
    created.userId = userData.user.id;
    const { data: org, error: orgError } = await admin.from("organizations")
      .insert({ name: `Bench Org ${stamp}`, phone: null, address: null, city: null, invoice_footer_note: null, default_payment_terms: "Due on receipt" })
      .select("id").single();
    if (orgError || !org?.id) throw new Error(`org insert failed: ${orgError?.message ?? "no org returned"}`);
    created.orgId = org.id;
    const { error: profileError } = await admin.from("profiles").insert({
      id: created.userId, organization_id: created.orgId, auth_user_id: created.userId,
      full_name: "Bench Owner", email, display_name: "Bench Owner",
      role: "owner", role_name: "owner", is_active: true,
    });
    if (profileError) throw new Error(`profile insert failed: ${profileError.message}`);
    console.log("  test owner + org ready (ids not printed)");
    if (claimlessMode) {
      // The whole point of --claimless: this user must have NO
      // organization_id claim. Provision is never called here (it would
      // write the claim); verify the absence explicitly so a silent
      // claim would fail the run instead of measuring the wrong thing.
      const { data: claimCheck, error: claimCheckError } = await admin.auth.admin.getUserById(created.userId);
      if (claimCheckError) throw new Error(`claim check failed: ${claimCheckError.message}`);
      const claim = claimCheck.user?.app_metadata?.organization_id;
      if (typeof claim === "string" && claim.length > 0) {
        throw new Error("claim-less mode: test owner unexpectedly HAS an organization_id claim — aborting, the comparison would be meaningless");
      }
      console.log("  claim-less confirmed: test owner has no organization_id claim");
    }

    const seedStart = performance.now();
    for (let i = 0; i < PRODUCT_COUNT; i += 500) {
      const batch = catalog.slice(i, i + 500).map((p, j) => ({
        organization_id: created.orgId,
        // The fixture names repeat (small brand x base x size pool) and
        // the DB has a unique (org, name) index for null-brand products
        // (CI run 44798963803: batch 500 collided). Suffix the 1-based
        // index so all 5,000 seeded names are unique; the save/search
        // measurements use product IDs and in-memory prices, not names.
        name: `${p.name} #${String(i + j + 1).padStart(5, "0")}`,
        sku: `BENCH-${stamp}-${String(i + j + 1).padStart(5, "0")}`,
        barcode: null,
        unit_type: p.unit_type ?? "Pack",
        units_per_pack: p.units_per_pack ?? null,
        default_selling_price: Math.round(Number(p.default_selling_price ?? 100) * 100) / 100,
        current_stock: 100000,
        is_active: true,
      }));
      const { data, error } = await admin.from("products").insert(batch).select("id");
      if (error) throw new Error(`product seed batch ${i} failed: ${error.message}`);
      created.productIds.push(...(data ?? []).map((r) => String(r.id)));
    }
    for (let i = 0; i < CUSTOMER_COUNT; i += 500) {
      const batch = customers.slice(i, i + 500).map((c) => ({
        organization_id: created.orgId,
        customer_name: c.name,
        customer_type: "Retailer",
        credit_policy: "cash_only",
        visit_frequency: "weekly",
        priority: "medium",
        is_active: true,
      }));
      const { data, error } = await admin.from("customers").insert(batch).select("id");
      if (error) throw new Error(`customer seed batch ${i} failed: ${error.message}`);
      created.customerIds.push(...(data ?? []).map((r) => String(r.id)));
    }
    const seedMs = performance.now() - seedStart;
    console.log(`  seeded ${created.productIds.length} products + ${created.customerIds.length} customers in ${(seedMs / 1000).toFixed(1)}s`);
    results.onlineSeed = { products: created.productIds.length, customers: created.customerIds.length, ms: +seedMs.toFixed(1) };

    console.log("\n=== ONLINE: sign in as the test owner ===");
    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) throw new Error(`sign-in failed: ${signInError?.message ?? "no session"}`);
    console.log("  signed in (JWT, no values printed)");
    const scope = `${created.orgId}:${created.userId}`;
    const onlineInput = (): AtomicSaleInput => {
      const lines = created.productIds.slice(0, INVOICE_LINES).map((id, idx) => {
        const price = Math.round(Number(catalog[idx]?.default_selling_price ?? 100) * 100) / 100;
        return { product_id: id, quantity: 1, selling_price: price, discount: 0, bonus: 0, unit_mode: "main" as const };
      });
      const total = Math.round(lines.reduce((s, l) => s + l.selling_price, 0) * 100) / 100;
      return {
        customer_id: created.customerIds[0], sale_date: saleDate, payment_type: "cash",
        invoice_discount: 0, invoice_discount_type: "flat", tax_rate: 0,
        cash_received: total, notes: null, credit_override_confirmed: false, lines,
      };
    };

    console.log(`\n=== ONLINE: raw RPC create_sales_invoice_atomic (${onlineRuns} sequential 100-line sales) ===`);
    type RpcOutcome = { data: { transaction?: Record<string, unknown>; items?: unknown[] } | null; error: { message?: string } | null };
    const callSaleRpc = (input: AtomicSaleInput) =>
      (userClient.rpc as unknown as (fn: string, params: Record<string, unknown>) => Promise<RpcOutcome>)(
        "create_sales_invoice_atomic", { p_request_id: randomUUID(), p_input: input },
      );
    const rpcTimes: number[] = [];
    for (let i = 0; i < onlineRuns; i++) {
      const input = onlineInput();
      const { result, ms } = await timeAsync(() => callSaleRpc(input));
      rpcTimes.push(ms);
      if (result.error || !result.data?.transaction) {
        throw new Error(`RPC sale ${i + 1} failed: ${result.error?.message ?? "no transaction returned"}`);
      }
      created.saleIds.push(String(result.data.transaction.id));
      const items = Array.isArray(result.data.items) ? result.data.items.length : -1;
      console.log(`  sale ${i + 1}: ${ms.toFixed(0)}ms invoice=${String(result.data.transaction.invoice_number ?? "?")} items=${items}`);
    }
    console.log(`  raw RPC: ${fmt(stats(rpcTimes))}`);
    results.onlineSaveRawRpc = { ms: stats(rpcTimes) };

    console.log(`\n=== ONLINE: real client path createAtomicSale (${onlineRuns} sequential 100-line sales) ===`);
    const clientTimes: number[] = [];
    for (let i = 0; i < onlineRuns; i++) {
      const input = onlineInput();
      const { result, ms } = await timeAsync(() =>
        createAtomicSale(userClient as unknown as Parameters<typeof createAtomicSale>[0], scope, input),
      );
      clientTimes.push(ms);
      if (!("result" in result)) {
        throw new Error(`createAtomicSale sale ${i + 1} did not confirm: ${JSON.stringify(Object.keys(result))}`);
      }
      created.saleIds.push(String((result.result.transaction as Record<string, unknown>).id));
      console.log(`  sale ${i + 1}: ${ms.toFixed(0)}ms invoice=${String((result.result.transaction as Record<string, unknown>).invoice_number ?? "?")} replayed=${result.result.replayed}`);
    }
    console.log(`  createAtomicSale: ${fmt(stats(clientTimes))}`);
    results.onlineSaveClientPath = { ms: stats(clientTimes) };

    if (claimlessMode) {
      // ── CLAIM-LESS GATE ──
      // (1) Save medians vs the claim baselines (run #4). The save RPC
      // resolves the org from the profile row either way, so expect these
      // to be close — this gate catches a regression, not the fallback.
      const rpcStats = stats(rpcTimes);
      const clientStats = stats(clientTimes);
      const rpcPct = ((rpcStats.median / CLAIM_BASELINE_RPC_MEDIAN_MS) - 1) * 100;
      const clientPct = ((clientStats.median / CLAIM_BASELINE_CLIENT_MEDIAN_MS) - 1) * 100;
      console.log("\n=== CLAIM-LESS: save medians vs claim baselines (run #4) ===");
      console.log(`  raw RPC median ${rpcStats.median.toFixed(2)}ms vs claim baseline ${CLAIM_BASELINE_RPC_MEDIAN_MS}ms (${rpcPct >= 0 ? "+" : ""}${rpcPct.toFixed(1)}%)`);
      console.log(`  client path median ${clientStats.median.toFixed(2)}ms vs claim baseline ${CLAIM_BASELINE_CLIENT_MEDIAN_MS}ms (${clientPct >= 0 ? "+" : ""}${clientPct.toFixed(1)}%)`);

      // (2) Server-side product search — the STRONG gate. These PostgREST
      // reads go through the products RLS policy, which evaluates
      // current_org_id(): a JWT claim read for the claim user, the Step 4
      // fallback profile lookup for the claim-less user. A second user in
      // the SAME org carries the claim, so the only difference between
      // the two measurements is the claim itself.
      console.log("\n=== CLAIM-LESS: server-side product search (RLS path) ===");
      const claimEmail = `bench-claim-${stamp}@bench.local`;
      const claimPassword = randomUUID();
      const { data: claimUserData, error: claimUserError } = await admin.auth.admin.createUser({
        email: claimEmail, password: claimPassword, email_confirm: true,
      });
      if (claimUserError || !claimUserData.user) throw new Error(`claim user createUser failed: ${claimUserError?.message ?? "no user returned"}`);
      const claimUserId = claimUserData.user.id;
      created.extraUserIds.push(claimUserId);
      const { error: claimProfileError } = await admin.from("profiles").insert({
        id: claimUserId, organization_id: created.orgId, auth_user_id: claimUserId,
        full_name: "Bench Claim Owner", email: claimEmail, display_name: "Bench Claim Owner",
        role: "owner", role_name: "owner", is_active: true,
      });
      if (claimProfileError) throw new Error(`claim user profile insert failed: ${claimProfileError.message}`);
      const { error: claimSetError } = await admin.auth.admin.updateUserById(claimUserId, {
        app_metadata: { organization_id: created.orgId },
      });
      if (claimSetError) throw new Error(`claim set failed: ${claimSetError.message}`);
      const { data: claimVerify, error: claimVerifyError } = await admin.auth.admin.getUserById(claimUserId);
      if (claimVerifyError) throw new Error(`claim verify failed: ${claimVerifyError.message}`);
      if (claimVerify.user?.app_metadata?.organization_id !== created.orgId) {
        throw new Error("claim user does not carry the organization_id claim after updateUserById — aborting, the comparison would be meaningless");
      }
      console.log("  claim user ready (same org, claim set and verified)");
      const claimClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: claimSignIn, error: claimSignInError } = await claimClient.auth.signInWithPassword({ email: claimEmail, password: claimPassword });
      if (claimSignInError || !claimSignIn.session) throw new Error(`claim user sign-in failed: ${claimSignInError?.message ?? "no session"}`);

      // The claim-less userClient above is still signed in as the
      // claim-less user. Measure both users shape by shape (interleaved,
      // so cache warming cannot favour one side).
      const searchShapes = [
        { name: "list50", run: (c: SupabaseClient) => c.from("products").select("id,name,default_selling_price,current_stock").limit(50) },
        { name: "ilikeOil", run: (c: SupabaseClient) => c.from("products").select("id,name").ilike("name", "%Oil%").limit(20) },
        { name: "ilikeShampoo", run: (c: SupabaseClient) => c.from("products").select("id,name").ilike("name", "%Shampoo%").limit(20) },
      ];
      const SEARCH_RUNS = 20;
      const searchOut: Record<string, unknown> = {};
      const claimlessAll: number[] = [];
      const claimAll: number[] = [];
      for (const shape of searchShapes) {
        const measure = async (c: SupabaseClient, label: string): Promise<{ s: Stats; rows: number; times: number[] }> => {
          await shape.run(c); // warmup (not timed)
          const times: number[] = [];
          let rows = 0;
          for (let i = 0; i < SEARCH_RUNS; i++) {
            // Await inside an async closure so timeAsync gets a real
            // Promise (the builder union is thenable but not a Promise).
            const { result, ms } = await timeAsync(async () => await shape.run(c));
            times.push(ms);
            if (result.error) throw new Error(`server search ${shape.name} (${label}) failed: ${result.error.message}`);
            rows = Array.isArray(result.data) ? result.data.length : 0;
          }
          return { s: stats(times), rows, times };
        };
        const less = await measure(userClient, "claim-less");
        const withClaim = await measure(claimClient, "claim");
        claimlessAll.push(...less.times);
        claimAll.push(...withClaim.times);
        console.log(`  ${shape.name}: claim-less median ${less.s.median.toFixed(2)}ms (rows=${less.rows}) vs claim median ${withClaim.s.median.toFixed(2)}ms (rows=${withClaim.rows})`);
        searchOut[shape.name] = { claimlessMs: less.s, claimMs: withClaim.s, rows: { claimless: less.rows, claim: withClaim.rows } };
        if (shape.name === "list50") {
          if (less.rows !== 50) throw new Error(`claim-less list50 must return 50 rows (got ${less.rows}) — Step 4 fallback missing, reads return nothing`);
          if (withClaim.rows !== 50) throw new Error(`claim list50 must return 50 rows (got ${withClaim.rows})`);
        }
      }
      const claimlessSearchMedian = stats(claimlessAll).median;
      const claimSearchMedian = stats(claimAll).median;
      const searchPct = ((claimlessSearchMedian / claimSearchMedian) - 1) * 100;
      console.log(`  server search combined median: claim-less ${claimlessSearchMedian.toFixed(2)}ms vs claim ${claimSearchMedian.toFixed(2)}ms (${searchPct >= 0 ? "+" : ""}${searchPct.toFixed(1)}%)`);

      const failures: string[] = [];
      if (rpcStats.median > CLAIM_BASELINE_RPC_MEDIAN_MS * CLAIMLESS_SLOWDOWN_LIMIT) {
        failures.push(`raw RPC median ${rpcStats.median.toFixed(2)}ms is more than 20% slower than the claim baseline ${CLAIM_BASELINE_RPC_MEDIAN_MS}ms`);
      }
      if (clientStats.median > CLAIM_BASELINE_CLIENT_MEDIAN_MS * CLAIMLESS_SLOWDOWN_LIMIT) {
        failures.push(`client-path median ${clientStats.median.toFixed(2)}ms is more than 20% slower than the claim baseline ${CLAIM_BASELINE_CLIENT_MEDIAN_MS}ms`);
      }
      if (claimlessSearchMedian > claimSearchMedian * CLAIMLESS_SLOWDOWN_LIMIT) {
        failures.push(`server search median ${claimlessSearchMedian.toFixed(2)}ms is more than 20% slower than the claim median ${claimSearchMedian.toFixed(2)}ms`);
      }
      results.claimless = {
        mode: "claimless",
        baselines: { rawRpcMedianMs: CLAIM_BASELINE_RPC_MEDIAN_MS, clientMedianMs: CLAIM_BASELINE_CLIENT_MEDIAN_MS },
        rpcMedianMs: rpcStats.median,
        clientMedianMs: clientStats.median,
        rpcPctSlower: +rpcPct.toFixed(1),
        clientPctSlower: +clientPct.toFixed(1),
        serverSearch: { ...searchOut, claimlessMedianMs: claimlessSearchMedian, claimMedianMs: claimSearchMedian, pctSlower: +searchPct.toFixed(1) },
        gate: failures.length === 0 ? "pass" : "fail",
      };
      if (failures.length > 0) {
        throw new Error(`CLAIM-LESS GATE FAILED: ${failures.join("; ")} — Step 4 must NOT go to production until this is fixed`);
      }
      console.log("  claim-less gate: PASS");
    }
  } finally {
    console.log("\n=== ONLINE: cleanup ===");
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const t0 = performance.now();
  if (mode === "local" || mode === "all") await runLocal();
  if (mode === "online" || mode === "all") await runOnline(claimless);
  results.totalMs = +(performance.now() - t0).toFixed(1);
  console.log(`\n=== DONE in ${(results.totalMs as number / 1000).toFixed(1)}s ===`);
  console.log(JSON.stringify(results, null, 2));
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`results written to ${outPath}`);
  }
}

main().catch((err: unknown) => {
  console.error(`BENCH FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
