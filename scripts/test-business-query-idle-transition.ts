/**
 * Business Query idle-transition bug (P1 Area J) — Unit Tests.
 *
 * Defect (live re-QA 2026-11-19 10:43, production 9f482d2): the 503
 * BRAIN_NOT_INITIALIZED fix worked — all 5 DevTools POSTs returned
 * 200 — but only #1 was answered directly. #2 got
 * "What would you like to know about your business?", #3 got
 * "What language? (auto, english, urdu, roman_urdu)", #4 got
 * "What type of query? (general, analytics_explainer)" and #5 got
 * "What date range? (today, this_week, this_month, custom)" — the
 * exact business_query field-collection walk, one field per message.
 *
 * Root cause: answerBusinessQuestionDirectly calls
 * updateConversationState(context, "idle") after answering, and
 * returns a hardcoded { state: "idle", actionType: null } — but
 * VALID_TRANSITIONS["waiting_for_intent"] does not list "idle", so
 * updateConversationState (conversation-engine.ts) silently no-ops
 * on the illegal transition (console.warn only) and returns the
 * context unchanged. The STORED session stays waiting_for_intent
 * with actionType "business_query" and collectedData {}. The next
 * message on the same warm instance never reaches handleNewIntent:
 * processMessage falls through to handleFieldUpdate, which walks
 * the business_query schema fields in order. The same latent bug
 * hits the inventory_query / staff_query / location_query direct
 * branches (they also transition to "idle" from
 * waiting_for_intent), but they null actionType before storing, so
 * they degrade differently.
 *
 * Fix (two parts, this slice only):
 *  1. conversation-engine.ts VALID_TRANSITIONS: "idle" is an
 *     allowed target of "waiting_for_intent".
 *  2. conversation-runtime.ts answerBusinessQuestionDirectly:
 *     belt-and-braces — explicitly null actionType / pendingField
 *     and clear collectedData before storing the session, mirroring
 *     what the inventory/staff/location branches already do.
 *
 * This test replays the EXACT live 5-message sequence through the
 * real brain chat path (getBusinessBrain().chat -> processMessage,
 * shared "default_session") in ONE process, with a real store built
 * by ensureServerBusinessBrain from a fake Supabase client (one
 * product, one customer) and a stub LLM: a local HTTP server behind
 * the ZAI provider slot (AI_PROVIDER_ORDER=zai, ZAI_BASE_URL
 * pointing at 127.0.0.1) answers intent_classification with canned
 * JSON and business_chat with a canned direct answer. No network,
 * no real LLM, no real Supabase.
 *
 * Two honest test-double notes:
 *  - The stub classifier supplies selling_price 250 for the sale
 *    message (the catalog price of COCA COLA 1L): the message itself
 *    carries no price, and (d)'s point is session routing — a fresh
 *    create_sale intent reaching confirmation instead of being eaten
 *    by the stale business_query walk — not classifier price
 *    extraction. On live, the real classifier may instead ask for
 *    the price; that is a legitimate create_sale question, not this
 *    bug.
 *  - One-shot confirmation is NOT reachable for create_sale even
 *    with the fix: getNextRequiredField walks required AND optional
 *    fields, so with all five required fields filled the runtime
 *    still asks the four optional fields (invoice_date,
 *    batch_number, expiry_date, notes) before confirming. That is
 *    pre-existing behaviour, OUT of scope for this slice (which
 *    fixes only the idle transition + session cleanup) — (d) drives
 *    those four answers ("today" / "no batch" / "no expiry" /
 *    "no notes") to reach the confirmation text. It is reported as
 *    a follow-up observation: live #4 will ask "What is the sale
 *    date?" rather than confirm in one turn.
 *  - After (d) the session awaits confirmation, so (e) is sent
 *    after an explicit "cancel" (a real user abandoning the pending
 *    sale). Without the cancel, (e) would re-present the pending
 *    confirmation — correct behaviour for a pending sale, and still
 *    not the date_range interrogation. The cancel keeps the shared
 *    session and lets (e) reach the chat fallback.
 *
 * Run: npx tsx scripts/test-business-query-idle-transition.ts
 */

import "./validation-environment";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getBusinessBrain } from "../src/lib/brain/bootstrap";
import { conversationRuntime } from "../src/lib/ai/conversation-runtime";
import {
  canTransition,
  createConversationContext,
  updateConversationState,
} from "../src/lib/ai/conversation-engine";
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

// The four business_query field questions the live run returned, in
// schema order. No fixed answer may ever be one of these.
const FIELD_STRINGS = [
  "What would you like to know about your business?",
  "What language? (auto, english, urdu, roman_urdu)",
  "What type of query? (general, analytics_explainer)",
  "What date range? (today, this_week, this_month, custom)",
];

// Canned direct answer the stub business_chat path returns.
const DIRECT_ANSWER = "Test direct answer: your business is running. (stubbed provider)";

function isFieldInterrogation(text: string): boolean {
  return FIELD_STRINGS.some((field) => text.includes(field));
}

/**
 * Canned classifier: keyed on the exact user message the runtime
 * embeds in the classification prompt as `User message: "..."`.
 */
function classifyUserMessage(message: string): Record<string, unknown> {
  const base = { entities: {}, confidence: 0.9 };
  switch (message) {
    case "mere business ka kya haal hai":
      return { ...base, intent: "business_query", language: "roman_urdu" };
    case "How much did we sell today?":
      return { ...base, intent: "business_query", language: "english" };
    case "aaj hum ne kitna becha hai?":
      return { ...base, intent: "business_query", language: "roman_urdu" };
    case "sell 2 COCA COLA 1L to Walk-in customer for cash":
      return {
        intent: "create_sale",
        language: "english",
        confidence: 0.9,
        entities: {
          customer_name: "Walk-in",
          product_name: "COCA COLA 1L",
          quantity: 2,
          // See header note: the message carries no price; the stub
          // supplies the catalog price so (d) can reach confirmation.
          selling_price: 250,
          payment_type: "cash",
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
 * Stub LLM behind the ZAI provider slot: the router POSTs OpenAI
 * chat-completions to ${ZAI_BASE_URL}/chat/completions. The prompt
 * carries a "Task: <task>" prefix, so the stub routes on it.
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
        // The runtime asks optional create_sale fields one by one;
        // the stub extracts a plain value for each field label.
        if (prompt.includes("Current field being asked: Invoice Date")) {
          content = JSON.stringify({ value: "2026-11-19", confidence: 0.9, clarification_needed: false });
        } else if (
          prompt.includes("Current field being asked: Batch Number") ||
          prompt.includes("Current field being asked: Expiry Date") ||
          prompt.includes("Current field being asked: Notes")
        ) {
          content = JSON.stringify({ value: "none", confidence: 0.9, clarification_needed: false });
        } else {
          content = JSON.stringify({ value: null, confidence: 0.1, clarification_needed: true });
        }
      } else if (prompt.includes("Task: business_chat")) {
        content = DIRECT_ANSWER;
      } else {
        content = DIRECT_ANSWER;
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
 * gateway brain-init test): one product + one customer, everything
 * else empty.
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
        return { data: { name: "OP TRADERS" }, error: null };
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

async function main(): Promise<void> {
  const stub = await startStubLlm();
  process.env.AI_PROVIDER_ORDER = "zai";
  process.env.ZAI_API_KEY = "stub-only-key";
  process.env.ZAI_BASE_URL = `http://127.0.0.1:${stub.port}`;
  process.env.ZAI_MODEL = "stub-model";
  try {
    console.log("(0) waiting_for_intent -> idle is a legal transition");
    check(
      canTransition("waiting_for_intent", "idle") === true,
      'VALID_TRANSITIONS lists "idle" for waiting_for_intent',
    );
    const fresh = createConversationContext("probe", ORG_ID, PROFILE_ID);
    const waiting = updateConversationState(fresh, "waiting_for_intent");
    check(waiting.state === "waiting_for_intent", "probe session reaches waiting_for_intent");
    const backToIdle = updateConversationState(waiting, "idle");
    check(backToIdle.state === "idle", "waiting_for_intent -> idle actually lands (not a silent no-op)");

    console.log("(setup) server-side brain init with one product + one customer");
    const inited = await ensureServerBusinessBrain(fakeSupabase(), ownerActor);
    check(inited.ok === true, "brain init succeeds with the fake org data");
    const brain = getBusinessBrain();
    check(brain !== null, "brain singleton exists after init");
    check(
      brain !== null && brain.getMemorySnapshot().productCount === 1,
      "store holds the COCA COLA 1L product",
    );
    check(
      brain !== null && brain.getMemorySnapshot().customerCount === 1,
      "store holds the Walk-in customer",
    );
    if (!brain) throw new Error("brain is null after init");

    console.log("(a) #1 'mere business ka kya haal hai' -> direct answer, session idle");
    const first = await brain.chat("mere business ka kya haal hai");
    check(first.ok === true, "#1 returns ok");
    check(
      typeof first.message === "string" && first.message.includes(DIRECT_ANSWER),
      "#1 is the direct answer, not a field question",
    );
    check(!isFieldInterrogation(first.message ?? ""), "#1 is not a business_query field question");
    const afterFirst = storedSession();
    check(afterFirst !== undefined, "session is stored after #1");
    check(afterFirst?.state === "idle", "stored session is idle after #1 (not waiting_for_intent)");
    check(afterFirst?.actionType === null, "stored session actionType is null after #1");
    check(afterFirst?.pendingField === null, "stored session pendingField is null after #1");
    check(
      afterFirst !== undefined && Object.keys(afterFirst.collectedData).length === 0,
      "stored session collectedData is empty after #1",
    );

    console.log("(b) #2 'How much did we sell today?' -> direct answer, not the question field");
    const second = await brain.chat("How much did we sell today?");
    check(second.ok === true, "#2 returns ok");
    check(
      typeof second.message === "string" && second.message.includes(DIRECT_ANSWER),
      "#2 is the direct answer",
    );
    check(
      !(second.message ?? "").includes("What would you like to know about your business?"),
      "#2 does NOT ask the business_query question field",
    );
    check(!isFieldInterrogation(second.message ?? ""), "#2 is not any business_query field question");
    check(storedSession()?.state === "idle", "stored session stays idle after #2");
    check(storedSession()?.actionType === null, "stored session actionType stays null after #2");

    console.log("(c) #3 'aaj hum ne kitna becha hai?' -> direct answer, not the language field");
    const third = await brain.chat("aaj hum ne kitna becha hai?");
    check(third.ok === true, "#3 returns ok");
    check(
      typeof third.message === "string" && third.message.includes(DIRECT_ANSWER),
      "#3 is the direct answer",
    );
    check(
      !(third.message ?? "").includes("What language? (auto, english, urdu, roman_urdu)"),
      "#3 does NOT ask the business_query language field",
    );
    check(!isFieldInterrogation(third.message ?? ""), "#3 is not any business_query field question");
    check(storedSession()?.state === "idle", "stored session stays idle after #3");

    console.log("(d) #4 sale message -> fresh create_sale intent, then confirmation");
    const fourth = await brain.chat("sell 2 COCA COLA 1L to Walk-in customer for cash");
    check(fourth.ok === true, "#4 returns ok");
    check(!isFieldInterrogation(fourth.message ?? ""), "#4 is not a business_query field question");
    check(
      !(fourth.message ?? "").includes("What is the selling price per unit?"),
      "#4 does NOT fall back to asking for the price (all required fields filled)",
    );
    check(
      typeof fourth.message === "string" &&
        fourth.message.includes("What is the sale date? (Defaults to today)"),
      "#4 asks the first optional create_sale field (invoice_date) — fresh intent, not the stale walk",
    );
    check(
      storedSession()?.state === "waiting_for_invoice_date",
      "session waits for invoice_date after #4",
    );
    check(
      storedSession()?.actionType === "create_sale",
      "session actionType is create_sale after #4",
    );
    check(
      storedSession()?.collectedData.quantity === 2,
      "session holds quantity 2 after #4",
    );
    check(
      storedSession()?.collectedData.payment_type === "cash",
      "session holds payment cash after #4",
    );

    console.log("(d2) answer the four optional fields to reach confirmation");
    const saleDate = await brain.chat("today");
    check(
      typeof saleDate.message === "string" &&
        saleDate.message.includes("Which batch to sell from? (Optional)"),
      "invoice_date answered -> runtime asks batch_number",
    );
    const batch = await brain.chat("no batch");
    check(
      typeof batch.message === "string" &&
        batch.message.includes("Expiry date for batch tracking? (Optional)"),
      "batch_number answered -> runtime asks expiry_date",
    );
    const expiry = await brain.chat("no expiry");
    check(
      typeof expiry.message === "string" &&
        expiry.message.includes("Any additional notes? (Optional)"),
      "expiry_date answered -> runtime asks notes",
    );
    const notes = await brain.chat("no notes");
    check(notes.ok === true, "notes answer returns ok");
    check(
      typeof notes.message === "string" &&
        notes.message.includes("Create Sale Invoice:"),
      "all fields filled -> create_sale confirmation summary",
    );
    check(
      typeof notes.message === "string" && notes.message.includes("Quantity: 2"),
      "confirmation carries quantity 2",
    );
    check(
      typeof notes.message === "string" && notes.message.includes("Payment: cash"),
      "confirmation carries payment cash",
    );
    check(
      typeof notes.message === "string" &&
        notes.message.includes("Please confirm with yes or no."),
      "confirmation asks for confirmation (text only — nothing confirmed, no sale executed)",
    );
    check(!isFieldInterrogation(notes.message ?? ""), "confirmation is not a business_query field question");
    check(
      storedSession()?.state === "waiting_for_confirmation",
      "session awaits confirmation after the optional fields",
    );
    check(
      storedSession()?.actionType === "create_sale",
      "session actionType is create_sale at confirmation",
    );

    console.log("(d3) cancel the pending sale so (e) can reach a fresh intent");
    const cancelled = await brain.chat("cancel");
    check(cancelled.ok === true, "cancel returns ok");
    check(
      typeof cancelled.message === "string" &&
        cancelled.message.toLowerCase().includes("cancelled"),
      "cancel acknowledges the cancellation",
    );

    console.log("(e) #5 'blorp zizzle wump' -> chat fallback, not the date_range field");
    const fifth = await brain.chat("blorp zizzle wump");
    check(fifth.ok === true, "#5 returns ok");
    check(
      typeof fifth.message === "string" && fifth.message.includes(DIRECT_ANSWER),
      "#5 falls back to chat with a direct answer",
    );
    check(
      !(fifth.message ?? "").includes("What date range? (today, this_week, this_month, custom)"),
      "#5 does NOT ask the business_query date_range field",
    );
    check(!isFieldInterrogation(fifth.message ?? ""), "#5 is not any business_query field question");
    check(storedSession()?.state === "idle", "stored session is idle after #5");
    check(storedSession()?.actionType === null, "stored session actionType is null after #5");

    console.log(`\nAll ${passed} business-query idle-transition checks passed.`);
  } finally {
    await stub.close();
  }
}

void main();
