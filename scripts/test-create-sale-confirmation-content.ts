/**
 * Create-sale confirmation content fix (Area J) — regression tests.
 *
 * Live defect (Business Query run #4, 2026-11-19 11:42, production
 * 33da412): the confirmation text read
 *   "Create Sale Invoice: • Customer: {customer_name} • Product:
 *   {product_name} • Quantity: 2 • Selling Price: 100 • Payment: cash
 *   • Invoice Date: 2024-05-22 • Batch: no batch • Expiry: no expiry
 *   • Should I proceed? Please confirm with yes or no."
 * even though the user had given "COCA COLA 1L" + "Walk-in customer"
 * in the first message.
 *
 * Three defects, each pinned here:
 *  (1) Placeholders: {customer_name} / {product_name} leaked literally
 *      because formatConfirmationSummary only substituted schema field
 *      keys (customer_id / product_id). The runtime now stores the
 *      resolved display names (_customer_name / _product_name) and the
 *      renderer substitutes them, with a fail-safe "—" sweep so a
 *      literal "{...}" can never reach the user.
 *  (2) Invoice date: "today" was extracted by the LLM, which invented
 *      the stale date 2024-05-22. It is now resolved server-side from
 *      now() in the ORG timezone (organizations.regional_preferences.
 *      timeZone, loaded into store.meta.timezone). The stub LLM below
 *      deliberately answers 2024-05-22 for the date field: if the
 *      deterministic intercept ever regresses, the confirmation shows
 *      2024-05-22 and this test fails.
 *  (3) Skip phrases: "no batch" / "no expiry" / "none" / "nahi" were
 *      stored raw. They now normalize to NULL — at the deterministic
 *      pre-LLM intercept AND for values the LLM returns — and NULL on
 *      an OPTIONAL field counts as answered, so the flow does not
 *      re-ask the skipped field forever. The confirmation renders
 *      skipped optionals as "—".
 *  (4) Currency: the confirmation shows the org books currency with
 *      the selling price ("Selling Price: 100 EUR"), read from
 *      organizations.books_currency into store.meta.currency.
 *
 * This test exercises confirmation and cancellation through the real
 * brain chat path (getBusinessBrain().chat -> processMessage, shared
 * "default_session") in ONE process, with a real store built by
 * ensureServerBusinessBrain from a fake Supabase client (one product,
 * one customer, org on EUR / Asia/Karachi) and a stub LLM: a local HTTP
 * server behind the ZAI provider slot (AI_PROVIDER_ORDER=zai,
 * ZAI_BASE_URL pointing at 127.0.0.1). No network, no real LLM, no
 * real Supabase. The final message is "cancel" — never "yes" — so no
 * sale is ever executed.
 *
 * The stub classifier supplies a price only for the message containing
 * one. The other cases exercise the catalog default and a product
 * without a usable default.
 *
 * Run: npx tsx scripts/test-create-sale-confirmation-content.ts
 */

import "./validation-environment";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getBusinessBrain } from "../src/lib/brain/bootstrap";
import { loadRawBusinessData } from "../src/lib/brain/supabase-loader";
import { conversationRuntime } from "../src/lib/ai/conversation-runtime";
import {
  createConversationContext,
  formatConfirmationSummary,
  getNextRequiredField,
} from "../src/lib/ai/conversation-engine";
import {
  isSkipPhrase,
  isTodayWord,
  normalizeSkipPhrase,
  todayInTimezone,
} from "../src/lib/ai/confirmation-content";
import { ensureServerBusinessBrain } from "../src/lib/conversation/server-brain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext } from "../src/lib/identity/types";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const PROFILE_ID = "00000000-0000-0000-0000-000000000002";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000011";
const UNPRICED_PRODUCT_ID = "00000000-0000-0000-0000-000000000012";
const CUSTOMER_ID = "00000000-0000-0000-0000-000000000021";

const ownerActor: ActorContext = {
  profileId: PROFILE_ID,
  organizationId: ORG_ID,
  email: "owner@example.com",
  role: "owner",
  isOwner: true,
  isActive: true,
  permissions: [],
};

/** The org timezone the fake org row carries. */
const ORG_TIMEZONE = "Asia/Karachi";

function classifyUserMessage(message: string): Record<string, unknown> {
  const base = { entities: {}, confidence: 0.9 };
  switch (message) {
    case "sell 2 COCA COLA 1L to Walk-in customer for 100":
    case "sell 2 COCA COLA 1L to Walk-in customer":
    case "sell 2 Unpriced Water to Walk-in customer for cash":
      return {
        intent: "create_sale",
        language: "english",
        confidence: 0.9,
        entities: {
          customer_name: "Walk-in",
          product_name: message.includes("Unpriced Water") ? "Unpriced Water" : "COCA COLA 1L",
          quantity: 2,
          selling_price: message.endsWith("100") ? 100 : null,
          payment_type: message.endsWith("cash") ? "cash" : null,
        },
      };
    default:
      return { ...base, intent: "unknown", language: "english" };
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Stub LLM behind the ZAI provider slot. The field extractor returns
 * POISON values on purpose: the live wrong date (2024-05-22) for the
 * invoice date and a fake batch code — if the deterministic intercept
 * ever regresses and the runtime consults the LLM for "today" /
 * "no batch", those poison values surface in the confirmation.
 */
function startStubLlm(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer(async (req, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req)) as {
        messages?: Array<{ content?: string }>;
      };
      const prompt = body.messages?.[0]?.content ?? "";
      let content: string;
      if (prompt.includes("Task: intent_classification")) {
        const match = prompt.match(/User message: "([\s\S]*?)"/);
        const userMessage = match ? match[1] : "";
        content = JSON.stringify(classifyUserMessage(userMessage));
      } else if (prompt.includes("Task: field_extraction")) {
        if (prompt.includes("Current field being asked: Invoice Date")) {
          content = JSON.stringify({ value: "2024-05-22", confidence: 0.9, clarification_needed: false });
        } else if (prompt.includes("Current field being asked: Batch Number")) {
          content = JSON.stringify({ value: "BATCH-999", confidence: 0.9, clarification_needed: false });
        } else if (prompt.includes("Current field being asked: Expiry Date")) {
          content = JSON.stringify({ value: "none", confidence: 0.9, clarification_needed: false });
        } else if (prompt.includes("Current field being asked: Notes")) {
          content = JSON.stringify({ value: "none", confidence: 0.9, clarification_needed: false });
        } else {
          content = JSON.stringify({ value: null, confidence: 0.1, clarification_needed: true });
        }
      } else {
        content = "Test direct answer (stubbed provider)";
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("stub LLM did not bind a port"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

type FakeQueryResult = { data: unknown; error: unknown };

/**
 * Minimal fake Supabase client (same thenable-builder surface as the
 * gateway brain-init test): one product + one customer, org on EUR /
 * Asia/Karachi.
 */
function fakeSupabase(): SupabaseClient {
  const rows: Record<string, unknown[]> = {
    products: [
      {
        id: PRODUCT_ID,
        name: "COCA COLA 1L",
        brand_id: null,
        category_id: null,
        unit_type: "piece",
        last_purchase_price: 200,
        default_selling_price: 250,
        minimum_stock_level: 0,
        reorder_level: 0,
        track_batch: false,
        track_expiry: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: UNPRICED_PRODUCT_ID,
        name: "Unpriced Water",
        unit_type: "piece",
        default_selling_price: null,
        is_active: true,
      },
    ],
    customers: [
      {
        id: CUSTOMER_ID,
        customer_name: "Walk-in",
        shop_name: null,
        phone: null,
        city: null,
        area: null,
        customer_type: "walk_in",
        credit_policy: "cash_only",
        credit_limit: 0,
        credit_days: 0,
        allow_over_limit: false,
        allow_overdue_sales: false,
        preferred_payment_method: "cash",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.order = () => builder;
    builder.maybeSingle = async (): Promise<FakeQueryResult> => {
      if (table === "organizations") {
        return {
          data: {
            name: "OP TRADERS",
            books_currency: "EUR",
            regional_preferences: { timeZone: "Asia/Karachi", accountingCurrency: "EUR" },
          },
          error: null,
        };
      }
      if (table === "profiles") {
        return {
          data: { display_name: "Umair", email: "owner@example.com" },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    builder.then = (resolve: (value: FakeQueryResult) => void) => {
      resolve({ data: rows[table] ?? [], error: null });
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function storedSession() {
  return conversationRuntime.getSession("default_session");
}

function saleContext(): ReturnType<typeof createConversationContext> {
  const context = createConversationContext("probe", ORG_ID, PROFILE_ID);
  context.actionType = "create_sale";
  context.collectedData = {
    customer_id: CUSTOMER_ID,
    _customer_name: "Walk-in",
    product_id: PRODUCT_ID,
    _product_name: "COCA COLA 1L",
    quantity: 2,
    selling_price: 100,
    payment_type: "cash",
    invoice_date: todayInTimezone(ORG_TIMEZONE),
    batch_number: null,
    expiry_date: null,
    notes: null,
  };
  return context;
}

async function main(): Promise<void> {
  const stub = await startStubLlm();
  process.env.AI_PROVIDER_ORDER = "zai";
  process.env.ZAI_API_KEY = "stub-key";
  process.env.ZAI_BASE_URL = `http://127.0.0.1:${stub.port}`;
  process.env.ZAI_MODEL = "stub-model";
  try {
    console.log("(1) skip phrases normalize to NULL, real values pass through");
    for (const phrase of ["no batch", "no expiry", "no notes", "none", "skip", "nahi", "koi nahi"]) {
      check(isSkipPhrase(phrase) === true, `isSkipPhrase("${phrase}")`);
      check(normalizeSkipPhrase(phrase) === null, `"${phrase}" normalizes to NULL`);
    }
    check(isSkipPhrase("No Batch") === true, 'skip match is case-insensitive ("No Batch")');
    check(isSkipPhrase("  NONE  ") === true, 'skip match trims whitespace ("  NONE  ")');
    check(isSkipPhrase("no") === false, 'bare "no" is NOT a skip phrase');
    check(isSkipPhrase("COCA COLA 1L") === false, '"COCA COLA 1L" is not a skip phrase');
    check(normalizeSkipPhrase("COCA COLA 1L") === "COCA COLA 1L", "a real value passes through unchanged");
    check(normalizeSkipPhrase("") === null, "blank normalizes to NULL");
    check(normalizeSkipPhrase(100) === 100, "a number passes through unchanged");

    console.log("(2) 'today' resolves server-side in the org timezone, never UTC");
    check(isTodayWord("today") === true, 'isTodayWord("today")');
    check(isTodayWord("aaj") === true, 'isTodayWord("aaj")');
    check(isTodayWord("2024-05-22") === false, '"2024-05-22" is not a today-word');
    // 22:30 UTC on the 19th is already the 20th in Asia/Karachi.
    const night = new Date("2026-11-19T22:30:00.000Z");
    check(todayInTimezone("Asia/Karachi", night) === "2026-11-20", "22:30 UTC is 2026-11-20 in Asia/Karachi");
    check(todayInTimezone("UTC", night) === "2026-11-19", "same instant is still 2026-11-19 in UTC");
    check(todayInTimezone("Pacific/Kiritimati", new Date("2026-11-19T12:00:00.000Z")) === "2026-11-20", "12:00 UTC is 2026-11-20 in UTC+14");
    check(todayInTimezone("Not/AZone", night) === "2026-11-20", "an invalid zone falls back to Asia/Karachi, never throws");

    console.log("(3) confirmation renderer: names interpolate, currency shows, skips show as —");
    const summary = formatConfirmationSummary(saleContext(), { currency: "EUR" });
    check(summary.includes("Customer: Walk-in"), "confirmation shows the customer name, not {customer_name}");
    check(summary.includes("Product: COCA COLA 1L"), "confirmation shows the product name, not {product_name}");
    check(summary.includes("Selling Price: 100 EUR"), "confirmation shows the org currency with the price");
    check(summary.includes(`Invoice Date: ${todayInTimezone(ORG_TIMEZONE)}`), "confirmation shows today's org-timezone date");
    check(summary.includes("Batch: —"), "skipped batch renders as —, not 'no batch'");
    check(summary.includes("Expiry: —"), "skipped expiry renders as —, not 'no expiry'");
    check(!summary.includes("{"), "no literal {placeholder} survives in the confirmation");
    check(!summary.includes("no batch") && !summary.includes("no expiry"), "no skip phrase text survives in the confirmation");
    const noCurrency = formatConfirmationSummary(saleContext());
    check(noCurrency.includes("Selling Price: 100") && !noCurrency.includes("100 EUR"), "without org currency the price renders bare (no invented currency)");
    const hintContext = createConversationContext("probe", ORG_ID, PROFILE_ID);
    hintContext.actionType = "create_sale";
    hintContext.collectedData = {
      _customer_name_hint: "Walk-in",
      _product_name_hint: "COCA COLA 1L",
      quantity: 2,
      selling_price: 100,
      payment_type: "cash",
      invoice_date: "2026-11-20",
      batch_number: null,
      expiry_date: null,
      notes: null,
    };
    const hintSummary = formatConfirmationSummary(hintContext, { currency: "EUR" });
    check(hintSummary.includes("Customer: Walk-in"), "an unresolved customer still renders its hint name");
    check(!hintSummary.includes("{"), "hint-only confirmation has no literal placeholder either");

    console.log("(4) NULL on an optional field counts as answered; required NULL still blocks");
    const skipped = saleContext();
    check(getNextRequiredField(skipped) === null, "all-skipped optionals do not block confirmation");
    const unanswered = saleContext();
    unanswered.collectedData.batch_number = undefined;
    check(getNextRequiredField(unanswered) === null, "a never-answered sale optional does not block");
    const requiredNull = saleContext();
    requiredNull.collectedData.quantity = null;
    check(getNextRequiredField(requiredNull) === "quantity", "a NULL required field still blocks");

    console.log("(5) loader: org timezone + books currency come from the organizations row");
    const raw = await loadRawBusinessData(fakeSupabase(), ORG_ID);
    check(raw !== null, "loader returns data for the fake org");
    check(raw?.timezone === "Asia/Karachi", "loader reads the org timezone from regional_preferences");
    check(raw?.currency === "EUR", "loader reads the org books currency");

    console.log("(6) sale confirmation, price defaults, and cancellation through brain chat");
    const inited = await ensureServerBusinessBrain(fakeSupabase(), ownerActor);
    check(inited.ok === true, "brain init succeeds with fake org data");
    const brain = getBusinessBrain();
    if (!brain) throw new Error("brain is null after init");

    const first = await brain.chat("sell 2 COCA COLA 1L to Walk-in customer for 100");
    check(first.ok === true && first.message.includes("Create Sale Invoice:"), "explicit price confirms immediately");
    check(first.message.includes("Customer: Walk-in") && first.message.includes("Product: COCA COLA 1L"), "confirmation uses resolved names");
    check(first.message.includes("Selling Price: 100 EUR"), "explicit price overrides the catalog price");
    check(first.message.includes(`Invoice Date: ${todayInTimezone(ORG_TIMEZONE)}`), "confirmation uses today's org date");
    check(first.message.includes("Batch: —") && first.message.includes("Expiry: —"), "unused optionals remain blank");
    check(!first.message.includes("{"), "confirmation contains no literal placeholders");
    check(storedSession()?.state === "waiting_for_confirmation", "sale requires confirmation");
    check((await brain.chat("cancel")).message.toLowerCase().includes("cancelled"), "explicit-price sale cancels");

    const prefilling = await brain.chat("sell 2 COCA COLA 1L to Walk-in customer");
    check(prefilling.message.includes("Selling Price: 250 EUR"), "catalog price fills the missing price immediately");
    check(storedSession()?.state === "waiting_for_confirmation", "catalog-price sale requires confirmation");
    check((await brain.chat("cancel")).message.toLowerCase().includes("cancelled"), "catalog-price sale cancels");

    const unpriced = await brain.chat("sell 2 Unpriced Water to Walk-in customer for cash");
    check(unpriced.message.includes("What is the selling price"), "unpriced product asks for a price");
    const rejected = await brain.chat("today");
    check(rejected.message.includes("Please give a number"), "a non-numeric answer re-asks for a number");
    check(storedSession()?.pendingField === "selling_price", "price is still pending");
    check(storedSession()?.collectedData.selling_price === undefined, "a non-numeric answer never becomes a price");
    const numeric = await brain.chat("95 EUR");
    check(numeric.message.includes("Selling Price: 95 EUR"), "a numeric reply advances to confirmation");
    check((await brain.chat("cancel")).message.toLowerCase().includes("cancelled"), "pending sale cancels");
    check(storedSession()?.state === "cancelled", "sale was cancelled without execution");
    console.log(`\nAll ${passed} create-sale confirmation-content checks passed.`);
  } finally {
    await stub.close();
  }
}

void main();
