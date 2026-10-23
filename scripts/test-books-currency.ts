/**
 * Books currency (Currency rework, foundation round):
 *  - the books formatter renders amounts denominated in the books
 *    currency UNCONVERTED (no FX division, no 1:1 relabelling), in at
 *    least two currencies, and ignores any display FX rate entirely;
 *  - effective-currency resolution (column -> regional_preferences ->
 *    PKR);
 *  - conversion math fixtures: a known dataset converts per-record at
 *    2dp half-away-from-zero, and control totals reconcile
 *    (before x rate = after within tolerance);
 *  - abort paths through the service seam: migration missing,
 *    same-currency, bad rate — none of them reach the execute step, and
 *    a double-submit converts exactly once.
 * Surface-migration round additions:
 *  - a source scan proving formatPKR survives only in the named
 *    allowlist (definition, two doc comments, the parked AI lane) and
 *    in none of the migrated files;
 *  - held-sale currency-stamp fixtures: matching stamp resumes,
 *    mismatched stamp is stale, unstamped legacy rows backfill with
 *    the current books currency and turn stale after a later switch.
 * Mop-up round additions:
 *  - a registry scan for the OTHER hardcoded-PKR pattern — a local
 *    Intl.NumberFormat formatter pinned to "PKR" — proving the two
 *    migrated manager pages no longer match it and that every file
 *    still matching it is named in a registry with a reason, so a
 *    new adopter fails the suite;
 *  - basket-template stamp fixtures: the held-sale lifecycle applied
 *    to POS basket templates (save stamps, legacy backfills and turns
 *    stale after a later switch, stale apply is blocked by status).
 * Final bypass round additions:
 *  - every remaining registry bypass that renders org books amounts
 *    (main page, manager + salesman satellites, EmployeeManagement,
 *    MySalesPerformance, retail-summary) is migrated; the registry
 *    now holds exactly two justified entries (the EUR-invoice PKR
 *    base formatter and the parked AI lane), and every migrated file
 *    is asserted clean of the pattern and wired to the books
 *    formatter, so a regression in any of them fails the suite.
 * Run: npx tsx scripts/test-books-currency.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  amountToHundredths,
  computeControlTotals,
  convertAmount,
  convertGroups,
  hundredthsToAmount,
  parseConversionRate,
  resolveBooksCurrency,
  verifyControlTotals,
  BooksConversionError,
} from "../src/lib/books/currency";
import { formatBooksAmount } from "../src/lib/books/format";
import {
  runBooksConversion,
  type BooksConversionDeps,
  type BooksConversionEvent,
} from "../src/lib/books/service";
import {
  formatBooksMoney,
  formatPKR,
  setActiveBooksCurrency,
  setActiveCurrency,
  setActiveFxRate,
} from "../src/lib/tradeos/formatters";
import {
  heldSaleCurrencyStatus,
  parseHeldSales,
  stampLegacyHeldSales,
  type HeldSale,
} from "../src/lib/sales/held-sales";
import {
  basketTemplateCurrencyStatus,
  parseBasketTemplates,
  stampLegacyBasketTemplates,
  type BasketTemplate,
} from "../src/lib/sales/basket-templates";

// ---------------------------------------------------------------------------
// Formatter: books amounts render unconverted, in the books currency.
// ---------------------------------------------------------------------------

const norm = (s: string) => s.replace(/\u00A0/g, " ");
assert.equal(norm(formatBooksAmount(312.45, "EUR", "en-US")), "€312.45");
assert.equal(norm(formatBooksAmount(312.45, "PKR", "en-US")), "PKR 312.45");
assert.equal(norm(formatBooksAmount(1234.5, "EUR", "es-ES")), "1234,50 €");
assert.equal(norm(formatBooksAmount(500, "JPY", "en-US")), "¥500", "JPY renders with 0 fraction digits");
assert.equal(norm(formatBooksAmount(0, "EUR", "en-US")), "€0.00");

// The stateful wrapper: even with a display currency AND a display FX
// rate active (the exact conditions under which formatPKR divides),
// formatBooksMoney must render the stored amount untouched.
setActiveCurrency("EUR", "en-US");
setActiveFxRate(312.45);
setActiveBooksCurrency("EUR");
assert.equal(norm(formatBooksMoney(312.45)), "€312.45", "books formatter never divides by the display rate");
assert.equal(norm(formatPKR(312.45)), "€1.00", "control: formatPKR DOES divide under the same state");
setActiveBooksCurrency("PKR");
assert.equal(norm(formatBooksMoney(312.45)), "PKR 312.45");
setActiveFxRate(null);
setActiveCurrency("PKR", "en-PK");

// ---------------------------------------------------------------------------
// Effective-currency resolution.
// ---------------------------------------------------------------------------

assert.equal(resolveBooksCurrency("EUR", null), "EUR");
assert.equal(resolveBooksCurrency(null, { accountingCurrency: "EUR" }), "EUR");
assert.equal(resolveBooksCurrency("USD", { accountingCurrency: "EUR" }), "USD", "column wins over preferences");
assert.equal(resolveBooksCurrency(null, null), "PKR");
assert.equal(resolveBooksCurrency("XXX", { accountingCurrency: "nope" }), "PKR");
assert.equal(resolveBooksCurrency(undefined, {}), "PKR");

// ---------------------------------------------------------------------------
// Rate validation.
// ---------------------------------------------------------------------------

assert.equal(parseConversionRate("0.0032").micro, BigInt(3200));
assert.equal(parseConversionRate(" 312.45 ").text, "312.45");
for (const bad of ["0", "0.0", "-1", "abc", "", "0.0000001", "1e3", "NaN"]) {
  assert.throws(
    () => parseConversionRate(bad),
    (err: unknown) => err instanceof BooksConversionError && err.code === "books.invalidRate",
    `rate ${JSON.stringify(bad)} must be rejected`,
  );
}

// ---------------------------------------------------------------------------
// Conversion math: exact, per-record, half away from zero at 2dp.
// ---------------------------------------------------------------------------

assert.equal(amountToHundredths("100.005"), BigInt(10001), "parse quantizes half away from zero");
assert.equal(amountToHundredths("-2.5"), BigInt(-250));
assert.equal(hundredthsToAmount(BigInt(-13)), "-0.13");
assert.equal(convertAmount("100000.00", parseConversionRate("0.0032").micro), "320.00");
assert.equal(convertAmount("250.50", parseConversionRate("0.0032").micro), "0.80");
assert.equal(convertAmount("33.33", parseConversionRate("0.0032").micro), "0.11");
assert.equal(
  convertAmount("50.00", parseConversionRate("0.0025").micro),
  "0.13",
  "0.125 rounds half AWAY from zero to 0.13 (not banker's 0.12)",
);
assert.equal(convertAmount("-50.00", parseConversionRate("0.0025").micro), "-0.13");
assert.equal(convertAmount("0.00", parseConversionRate("0.0032").micro), "0.00");

// ---------------------------------------------------------------------------
// Control totals over a known dataset: before x rate = after.
// ---------------------------------------------------------------------------

const dataset: Record<string, string[]> = {
  salesTotal: ["100000.00", "250.50", "33.33"],
  purchaseTotal: ["42000.00", "1999.99"],
  productPrices: ["1500.00", "899.95", "0.00"],
};
const rate = parseConversionRate("0.0032");
const beforeTotals = computeControlTotals(dataset);
assert.deepEqual(beforeTotals.salesTotal, { total: "100283.83", units: 3 });

const convertedDataset = convertGroups(dataset, rate.micro);
assert.deepEqual(convertedDataset.salesTotal, ["320.00", "0.80", "0.11"]);
const afterTotals = computeControlTotals(convertedDataset);
assert.deepEqual(
  verifyControlTotals(beforeTotals, afterTotals, rate.micro),
  [],
  "converted dataset reconciles: after = before x rate within tolerance",
);

// A tampered after-total must be caught.
const tampered = { ...afterTotals, salesTotal: { total: "999.00", units: 3 } };
assert.deepEqual(verifyControlTotals(beforeTotals, tampered, rate.micro), ["salesTotal"]);
// A missing control is a violation too.
const missing: Record<string, { total: string; units: number }> = { ...afterTotals };
delete missing.purchaseTotal;
assert.deepEqual(verifyControlTotals(beforeTotals, missing, rate.micro), ["purchaseTotal"]);

// ---------------------------------------------------------------------------
// Service abort paths (fake deps; execute must never run on aborts).
// ---------------------------------------------------------------------------

const ORG = "11111111-1111-4111-8111-111111111111";
const OWNER = "33333333-3333-4333-8333-333333333333";

function fakeDeps(overrides: Partial<BooksConversionDeps>): BooksConversionDeps {
  return {
    loadState: async () => ({ kind: "ready", currency: "PKR" }),
    execute: async () => {
      throw new Error("execute must not be called");
    },
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof BooksConversionError, `expected BooksConversionError, got ${String(err)}`);
    assert.equal((err as BooksConversionError).code, code);
    return true;
  });
}

async function main() {
  // Migration missing: refuses before execute.
  {
    let executed = false;
    const deps = fakeDeps({
      loadState: async () => ({ kind: "missing" }),
      execute: async () => {
        executed = true;
        throw new Error("unreachable");
      },
    });
    await expectCode(
      runBooksConversion(deps, { organizationId: ORG, actorProfileId: OWNER, toCurrency: "EUR", rate: "0.0032" }),
      "books.migrationMissing",
    );
    assert.equal(executed, false);
  }

  // Same currency: refuses before execute.
  {
    let executed = false;
    const deps = fakeDeps({
      execute: async () => {
        executed = true;
        throw new Error("unreachable");
      },
    });
    await expectCode(
      runBooksConversion(deps, { organizationId: ORG, actorProfileId: OWNER, toCurrency: "PKR", rate: "1" }),
      "books.sameCurrency",
    );
    assert.equal(executed, false);
  }

  // Bad rates and bad currencies: refused before ANY dep is touched.
  for (const badRate of ["0", "-3", "abc", "0.0000001"]) {
    let loaded = false;
    const deps = fakeDeps({
      loadState: async () => {
        loaded = true;
        return { kind: "ready", currency: "PKR" };
      },
    });
    await expectCode(
      runBooksConversion(deps, { organizationId: ORG, actorProfileId: OWNER, toCurrency: "EUR", rate: badRate }),
      "books.invalidRate",
    );
    assert.equal(loaded, false, "rate validation precedes state reads");
  }
  await expectCode(
    runBooksConversion(fakeDeps({}), { organizationId: ORG, actorProfileId: OWNER, toCurrency: "XXX", rate: "1" }),
    "books.currencyInvalid",
  );

  // Happy path + double-submit: the fake store flips its books currency
  // inside execute (like the SQL function); the second submit re-reads
  // state, sees the new currency, and aborts as same-currency — the
  // dataset is converted exactly once.
  {
    const store: { currency: string; groups: Record<string, string[]>; executions: number } = {
      currency: "PKR",
      groups: { salesTotal: ["100000.00", "250.50"] },
      executions: 0,
    };
    const deps: BooksConversionDeps = {
      loadState: async () => ({ kind: "ready", currency: store.currency as never }),
      execute: async (input) => {
        store.executions += 1;
        const before = computeControlTotals(store.groups);
        store.groups = convertGroups(store.groups, parseConversionRate(input.rateText).micro);
        store.currency = input.toCurrency;
        const after = computeControlTotals(store.groups);
        return {
          id: "event-1",
          organizationId: input.organizationId,
          actorProfileId: input.actorProfileId,
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          rate: input.rateText,
          controlTotalsBefore: before,
          controlTotalsAfter: after,
        } satisfies BooksConversionEvent;
      },
    };
    const event = await runBooksConversion(deps, {
      organizationId: ORG,
      actorProfileId: OWNER,
      toCurrency: "EUR",
      rate: "0.0032",
    });
    assert.equal(event.fromCurrency, "PKR");
    assert.equal(event.toCurrency, "EUR");
    assert.deepEqual(store.groups.salesTotal, ["320.00", "0.80"]);

    await expectCode(
      runBooksConversion(deps, { organizationId: ORG, actorProfileId: OWNER, toCurrency: "EUR", rate: "0.0032" }),
      "books.sameCurrency",
    );
    assert.equal(store.executions, 1, "double-submit executed the conversion exactly once");
    assert.deepEqual(store.groups.salesTotal, ["320.00", "0.80"], "amounts untouched by the repeat submit");
  }

  // A reconciliation mismatch reported by execute is surfaced, with the
  // event attached for audit (the SQL abort path itself is pre-commit
  // and raises books.reconciliationFailed inside the database).
  {
    const deps = fakeDeps({
      execute: async (input) => ({
        id: "event-bad",
        organizationId: input.organizationId,
        actorProfileId: input.actorProfileId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: input.rateText,
        controlTotalsBefore: { salesTotal: { total: "100.00", units: 1 } },
        controlTotalsAfter: { salesTotal: { total: "50.00", units: 1 } },
      }),
    });
    await assert.rejects(
      runBooksConversion(deps, { organizationId: ORG, actorProfileId: OWNER, toCurrency: "EUR", rate: "0.0032" }),
      (err: unknown) => {
        assert.ok(err instanceof BooksConversionError);
        assert.equal((err as BooksConversionError).code, "books.reconciliationMismatch");
        assert.equal((err as BooksConversionError & { event?: BooksConversionEvent }).event?.id, "event-bad");
        return true;
      },
    );
  }

  // -------------------------------------------------------------------------
  // Surface migration (this round): formatPKR — the display-rate
  // formatter — may survive ONLY in the named places below. Every org
  // surface renders books amounts through formatBooksMoney; if a
  // future change reintroduces formatPKR anywhere else (above all in
  // a migrated file), this scan fails.
  // -------------------------------------------------------------------------
  {
    // Files allowed to keep mentioning formatPKR, with the reason.
    // Keep this list honest: an entry whose file no longer mentions
    // formatPKR fails the last assertion below.
    const allowlist = new Map<string, string>([
      ["src/lib/tradeos/formatters.ts", "the definition itself (formatPKR + formatCurrency alias) and the books-wrapper docs"],
      ["src/lib/books/format.ts", "doc comment contrasting the books formatter with formatPKR — no call"],
      ["src/components/regional/FxRatesPanel.tsx", "doc comment only — the panel edits FX rates for the EUR-invoicing/display legacy"],
      ["src/lib/ai/business-intelligence.ts", "AI lane (parked): formatRs wraps formatPKR for /api/ai routes only; server-side formatter state is not org-resolved"],
    ]);
    const migratedFiles = [
      "src/app/page.tsx",
      "src/components/sales/CustomerHistory.tsx",
      "src/components/import-export/HistoricalRecords.tsx",
      "src/components/regional/CurrencySwitcher.tsx",
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (!readFileSync(full, "utf8").includes("formatPKR")) continue;
        const rel = path.relative(process.cwd(), full).split(path.sep).join("/");
        if (!allowlist.has(rel)) offenders.push(rel);
      }
    };
    walk(path.join(process.cwd(), "src"));
    assert.deepEqual(offenders, [], `formatPKR crept back outside the allowlist: ${offenders.join(", ")}`);
    for (const rel of migratedFiles) {
      assert.ok(
        !readFileSync(path.join(process.cwd(), rel), "utf8").includes("formatPKR"),
        `${rel} was migrated to the books formatter and must not reference formatPKR`,
      );
    }
    for (const rel of allowlist.keys()) {
      assert.ok(
        readFileSync(path.join(process.cwd(), rel), "utf8").includes("formatPKR"),
        `allowlist entry ${rel} no longer mentions formatPKR — remove it from the allowlist`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Held-sale currency guard: a held sale is denominated in the books
  // currency stamped on it at hold time. Matching stamp resumes,
  // a mismatched stamp is stale (blocked by RetailPOS), and an
  // unstamped legacy row is treated as denominated in the books
  // currency in force when it was held — the POS backfills the stamp
  // at load, so a later switch turns the row stale.
  // -------------------------------------------------------------------------
  {
    const sale = {
      lines: [],
      customerId: null,
      date: "2026-10-23",
      paymentType: "cash" as const,
      discount: "",
      discountType: "flat" as const,
      tax: "",
    };
    const stamped: HeldSale = { id: "h-1", savedAt: "2026-10-23T00:00:00.000Z", currency: "EUR", sale };
    const unstamped: HeldSale = { id: "h-2", savedAt: "2026-10-23T00:00:00.000Z", sale };

    assert.equal(heldSaleCurrencyStatus(stamped, "EUR"), "current", "matching stamp resumes");
    assert.equal(heldSaleCurrencyStatus(stamped, "PKR"), "stale", "mismatched stamp blocks");
    assert.equal(heldSaleCurrencyStatus(unstamped, "PKR"), "legacy", "unstamped rows are legacy");

    const filled = stampLegacyHeldSales([stamped, unstamped], "PKR");
    assert.equal(filled.stamped, true);
    assert.equal(filled.rows[0], stamped, "stamped rows pass through by identity");
    assert.equal(filled.rows[1].currency, "PKR", "legacy rows are backfilled with the current books currency");
    assert.equal(
      heldSaleCurrencyStatus(filled.rows[1], "EUR"),
      "stale",
      "a backfilled row turns stale when the books switch later",
    );
    const onlyStamped = [stamped];
    const noop = stampLegacyHeldSales(onlyStamped, "EUR");
    assert.equal(noop.stamped, false);
    assert.equal(noop.rows, onlyStamped, "no-op backfill returns the original array untouched");

    // Storage round-trip: the stamp survives the strict parser, an
    // invalid stamp is rejected outright, and legacy rows parse with
    // no stamp.
    assert.equal(parseHeldSales(JSON.stringify([stamped]))[0].currency, "EUR");
    assert.equal(parseHeldSales(JSON.stringify([unstamped]))[0].currency, undefined);
    assert.throws(() => parseHeldSales(JSON.stringify([{ ...stamped, currency: "BTC" }])));
  }

  // -------------------------------------------------------------------------
  // The OTHER hardcoded-PKR pattern. formatPKR is not the only way to
  // mislabel a books amount — pages and components grew local
  // Intl.NumberFormat formatters pinned to currency: "PKR". Every such
  // file that renders ORG BOOKS amounts has now been migrated to the
  // books formatter (the migratedFiles list below — each is asserted
  // clean of the pattern AND wired to the books formatter, so a
  // regression in any of them fails this suite). The registry of files
  // still ALLOWED to match is exactly two, each justified:
  //
  // The pattern anchors on the Intl.NumberFormat constructor and a
  // currency: "PKR" option within a short window (the option object,
  // one line or the next few), with a non-word character before
  // "currency" so data literals like base_currency: 'PKR' never match.
  // -------------------------------------------------------------------------
  {
    const pkrIntlPattern = /Intl\.NumberFormat\([\s\S]{0,160}?(?<![\w])currency:\s*["']PKR["']/;
    const registry = new Map<string, string>([
      ["src/components/eur/EurInvoiceForm.tsx", "formats the PKR BASE equivalents of EUR documents — the EUR subsystem's base currency is PKR by design; the EUR amounts themselves use its EUR formatter"],
      ["src/lib/import-export/historical-ai-summary.ts", "AI lane (parked, UMAIR 2026-10-22): server-side AI summary strings via a local formatMoney. The books currency is resolved client-side only, so a correct migration belongs with the AI unpark work, not a blind swap"],
    ]);
    // Every file migrated off the pattern, with the books-formatter
    // token its formatter path must reference. The satellite pages'
    // local fmt()/money() helpers are module-private (no importable
    // seam), so their fixture is this source-level assertion plus the
    // runtime fixtures for the importable seams (books formatter,
    // retail summary).
    const migratedFiles = new Map<string, string>([
      ["src/app/page.tsx", "formatBooksMoney"],
      ["src/app/manager/page.tsx", "formatBooksMoney"],
      ["src/app/manager/collections/page.tsx", "formatBooksMoney"],
      ["src/app/manager/drafts/page.tsx", "formatBooksMoney"],
      ["src/app/manager/targets/page.tsx", "formatBooksMoney"],
      ["src/app/manager/performance/page.tsx", "formatBooksMoney"],
      ["src/app/manager/team/[id]/page.tsx", "formatBooksMoney"],
      ["src/app/salesman/page.tsx", "formatBooksMoney"],
      ["src/app/salesman/collections/page.tsx", "formatBooksMoney"],
      ["src/app/salesman/drafts/page.tsx", "formatBooksMoney"],
      ["src/app/salesman/visits/[id]/page.tsx", "formatBooksMoney"],
      ["src/components/fsm/EmployeeManagement.tsx", "formatBooksMoney"],
      ["src/components/salesman/MySalesPerformance.tsx", "formatBooksMoney"],
      ["src/lib/sales/retail-summary.ts", "formatBooksAmount"],
    ]);
    const matching: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (!pkrIntlPattern.test(readFileSync(full, "utf8"))) continue;
        matching.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
      }
    };
    walk(path.join(process.cwd(), "src"));
    assert.deepEqual(
      matching.filter(rel => !registry.has(rel)),
      [],
      "a hardcoded-PKR Intl formatter appeared outside the two-entry registry — migrate it to the books formatter or record it in the registry with a justification",
    );
    for (const rel of registry.keys()) {
      assert.ok(
        matching.includes(rel),
        `registry entry ${rel} no longer pins an Intl formatter to PKR — remove it from the registry (it was migrated)`,
      );
    }
    for (const [rel, token] of migratedFiles) {
      assert.ok(!matching.includes(rel), `${rel} was migrated to the books formatter and must not pin an Intl formatter to PKR`);
      assert.ok(
        readFileSync(path.join(process.cwd(), rel), "utf8").includes(token),
        `${rel} was migrated to the books formatter and must reference ${token}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Basket-template currency guard: templates carry the same stamp as
  // held sales (same shared rule). A template saved under the current
  // books currency applies; a mismatched stamp is stale (blocked by
  // RetailPOS, kept as stored); an unstamped legacy template backfills
  // at load and turns stale after a later switch.
  // -------------------------------------------------------------------------
  {
    const sale = {
      lines: [],
      customerId: null,
      date: "2026-10-23",
      paymentType: "cash" as const,
      discount: "",
      discountType: "flat" as const,
      tax: "",
    };
    const stamped: BasketTemplate = { id: "b-1", name: "Morning basket", sale, savedAt: "2026-10-23T00:00:00.000Z", currency: "EUR" };
    const unstamped: BasketTemplate = { id: "b-2", name: "Legacy basket", sale, savedAt: "2026-10-23T00:00:00.000Z" };

    assert.equal(basketTemplateCurrencyStatus(stamped, "EUR"), "current", "matching stamp applies");
    assert.equal(basketTemplateCurrencyStatus(stamped, "PKR"), "stale", "mismatched stamp blocks the apply");
    assert.equal(basketTemplateCurrencyStatus(unstamped, "PKR"), "legacy", "unstamped templates are legacy");

    const filled = stampLegacyBasketTemplates([stamped, unstamped], "PKR");
    assert.equal(filled.stamped, true);
    assert.equal(filled.rows[0], stamped, "stamped templates pass through by identity");
    assert.equal(filled.rows[1].currency, "PKR", "legacy templates are backfilled with the current books currency");
    assert.equal(
      basketTemplateCurrencyStatus(filled.rows[1], "EUR"),
      "stale",
      "a backfilled template turns stale when the books switch later",
    );
    const onlyStamped = [stamped];
    const noop = stampLegacyBasketTemplates(onlyStamped, "EUR");
    assert.equal(noop.stamped, false);
    assert.equal(noop.rows, onlyStamped, "no-op backfill returns the original array untouched");

    // Storage round-trip: the stamp survives the parser, legacy rows
    // parse unstamped, structurally invalid rows are filtered, and a
    // row with an invalid stamp is dropped (its amounts' denomination
    // is unknowable). A non-array value throws, as the old reader did.
    assert.equal(parseBasketTemplates(JSON.stringify([stamped]))[0].currency, "EUR");
    assert.equal(parseBasketTemplates(JSON.stringify([unstamped]))[0].currency, undefined);
    assert.equal(parseBasketTemplates(JSON.stringify([{ ...stamped, currency: "BTC" }])).length, 0);
    assert.equal(parseBasketTemplates(JSON.stringify([{ id: 7 }, null, stamped])).length, 1);
    assert.equal(parseBasketTemplates(null).length, 0);
    assert.throws(() => parseBasketTemplates("{}"));
  }

  console.log("test-books-currency: all assertions passed");
}

void main();
