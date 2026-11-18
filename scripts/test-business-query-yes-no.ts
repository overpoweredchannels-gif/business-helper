/**
 * Business Query yes/no bug (P1 Area J) — Unit Tests.
 *
 * Defect: a classified `business_query` was driven through the
 * create-action gauntlet in `handleNewIntent`
 * (src/lib/ai/conversation-runtime.ts). Its schema requires the field
 * `question`, but nothing in the entity-filling block ever fills it —
 * the user's raw message IS the question, yet it was never stored —
 * so `getNextRequiredField` returned "question" and the user was asked
 * "What would you like to know about your business?" and had to REPEAT
 * the question. Then `getMissingRequiredFields` also returned the
 * missing OPTIONAL fields, so the user was interrogated for language,
 * query_type and date_range. Only then did `presentConfirmation` fire:
 * "Ask Business Question: ... Please confirm with yes or no." — for a
 * question that needs no confirmation at all. Worse, confirming never
 * produced an answer: `executeBusinessQuery` maps to "TODO" and
 * `executeAction` has no `business_query` branch, so a "yes" fell
 * through to the generic "Done! What would you like to do next?"
 * with no answer.
 *
 * Fix: `handleNewIntent` answers a classified `business_query`
 * DIRECTLY, following the `inventory_query` / `staff_query` /
 * `location_query` early-return pattern in the same function — the raw
 * message is the question, the answer comes from the runtime's existing
 * business-chat path (`callAiProviderRouter`, task "business_chat",
 * grounded on the store's business context), and the session returns
 * to idle with actionType null. No field collection, no confirmation.
 * The classifier's detected language is preserved into the prompt.
 * The `business_query` schema is left untouched.
 *
 * This test imports the production helpers directly (no mirroring)
 * and asserts the wiring on the real conversation-runtime.ts source.
 *
 * Run: npx tsx scripts/test-business-query-yes-no.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBusinessQueryDirectPrompt,
  businessQueryLanguageLine,
  resolveBusinessQueryLanguage,
  resolveBusinessQueryQuestion,
  shouldAnswerBusinessQueryDirectly,
} from "../src/lib/ai/business-query-direct";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function main(): void {
  const runtimeSource = readFileSync("src/lib/ai/conversation-runtime.ts", "utf8");
  const engineSource = readFileSync("src/lib/ai/conversation-engine.ts", "utf8");

  console.log("(a) a classified business question is answered directly");
  check(
    shouldAnswerBusinessQueryDirectly("business_query") === true,
    "business_query is answered directly",
  );
  check(
    runtimeSource.includes("shouldAnswerBusinessQueryDirectly(classification.intent)"),
    "handleNewIntent routes through shouldAnswerBusinessQueryDirectly",
  );
  check(
    runtimeSource.includes("answerBusinessQuestionDirectly("),
    "runtime has an answerBusinessQuestionDirectly method",
  );
  const branchIndex = runtimeSource.indexOf("shouldAnswerBusinessQueryDirectly(classification.intent)");
  const fieldFlowIndex = runtimeSource.indexOf("const nextField = getNextRequiredField(context);");
  check(
    branchIndex > 0 && fieldFlowIndex > 0 && branchIndex < fieldFlowIndex,
    "business_query branch returns BEFORE the field-collection flow",
  );
  const branchSlice = runtimeSource.slice(branchIndex, fieldFlowIndex);
  check(
    branchSlice.includes("answerBusinessQuestionDirectly("),
    "business_query branch calls answerBusinessQuestionDirectly",
  );
  check(
    !branchSlice.includes("presentConfirmation"),
    "business_query branch never reaches presentConfirmation",
  );
  check(
    !branchSlice.includes("getNextRequiredField"),
    "business_query branch never asks for the next required field",
  );
  check(
    runtimeSource.includes('return { response, state: "idle", actionType: null };'),
    "direct answer returns state idle with actionType null",
  );
  check(
    branchSlice.includes("classification.language"),
    "branch passes the classifier's detected language to the answer",
  );

  console.log("(b) the question used is the raw user message (no re-asking)");
  check(
    resolveBusinessQueryQuestion("mere business ka kya haal hai") === "mere business ka kya haal hai",
    "raw message is the question, verbatim",
  );
  check(
    resolveBusinessQueryQuestion("  How much did we sell today?  ") === "How much did we sell today?",
    "question is trimmed, not rewritten",
  );
  check(
    resolveBusinessQueryQuestion("") === null,
    "blank message resolves to null (honest fallback, not the gauntlet)",
  );
  check(
    resolveBusinessQueryQuestion("   ") === null,
    "whitespace-only message resolves to null",
  );
  check(
    !runtimeSource.includes("collectedData.question =") &&
      !runtimeSource.includes('collectedData["question"] =') &&
      !runtimeSource.includes("entities.question"),
    "handleNewIntent never fills collectedData.question from entities",
  );
  check(
    !buildBusinessQueryDirectPrompt({
      question: "mere business ka kya haal hai",
      language: "auto",
      businessContext: "",
      history: "",
    }).includes("What would you like to know about your business?"),
    "direct prompt never re-asks the question",
  );

  console.log("(c) optional fields language / query_type / date_range are NOT interrogated");
  const prompt = buildBusinessQueryDirectPrompt({
    question: "mere business ka kya haal hai",
    language: "roman_urdu",
    businessContext: "Sales: 10 invoices, total 5000.",
    history: "user: hello",
  });
  check(
    !prompt.includes("What language?") &&
      !prompt.includes("What type of query?") &&
      !prompt.includes("What date range?"),
    "direct prompt asks for no optional field",
  );
  check(
    !prompt.includes("Please confirm with yes or no."),
    "direct prompt never asks for confirmation",
  );
  check(
    prompt.includes("USER: mere business ka kya haal hai"),
    "prompt carries the raw question verbatim",
  );
  check(
    prompt.includes("Sales: 10 invoices, total 5000."),
    "prompt carries the business context",
  );
  check(
    prompt.includes("RECENT CONVERSATION:\nuser: hello"),
    "prompt carries recent conversation history",
  );
  check(
    prompt.includes("Reply in Roman Urdu (Urdu written in Latin letters)."),
    "prompt preserves the detected Roman Urdu language",
  );
  check(
    resolveBusinessQueryLanguage("roman_urdu") === "roman_urdu",
    "classifier language roman_urdu is preserved",
  );
  check(
    resolveBusinessQueryLanguage("urdu") === "urdu",
    "classifier language urdu is preserved",
  );
  check(
    resolveBusinessQueryLanguage("english") === "english",
    "classifier language english is preserved",
  );
  check(
    resolveBusinessQueryLanguage("auto") === "auto",
    "classifier language auto stays auto",
  );
  check(
    resolveBusinessQueryLanguage(undefined) === "auto",
    "missing language defaults to auto (mirror the question)",
  );
  check(
    resolveBusinessQueryLanguage("klingon") === "auto",
    "unknown language value defaults to auto",
  );
  check(
    businessQueryLanguageLine("urdu") === "Reply in Urdu.",
    "urdu language line",
  );
  check(
    businessQueryLanguageLine("english") === "Reply in English.",
    "english language line",
  );
  check(
    businessQueryLanguageLine("auto") === "Reply in the same language style as the question.",
    "auto language line mirrors the question",
  );

  console.log("(d) create_sale / create_purchase flows still confirm unchanged");
  check(
    shouldAnswerBusinessQueryDirectly("create_sale") === false,
    "create_sale is NOT answered directly",
  );
  check(
    shouldAnswerBusinessQueryDirectly("create_purchase") === false,
    "create_purchase is NOT answered directly",
  );
  check(
    shouldAnswerBusinessQueryDirectly("create_expense") === false,
    "create_expense is NOT answered directly",
  );
  check(
    shouldAnswerBusinessQueryDirectly("create_task") === false,
    "create_task is NOT answered directly",
  );
  check(
    (runtimeSource.match(/return await this\.presentConfirmation\(context, sessionId\);/g) ?? []).length >= 2,
    "presentConfirmation is still reached by the field flows",
  );
  check(
    runtimeSource.includes('if (context.actionType === "create_sale") {'),
    "executeAction still has its create_sale branch",
  );
  check(
    runtimeSource.includes('if (context.actionType === "create_purchase") {'),
    "executeAction still has its create_purchase branch",
  );
  check(
    runtimeSource.indexOf("permissionDenialResponse(context, intent, sessionId)") <
      runtimeSource.indexOf("shouldAnswerBusinessQueryDirectly(classification.intent)"),
    "permission gate still runs before the business_query branch",
  );

  console.log("(e) inventory_query / staff_query / location_query branches unchanged");
  for (const intent of ["inventory_query", "staff_query", "location_query"] as const) {
    check(
      runtimeSource.includes(`if (classification.intent === "${intent}") {`),
      `${intent} early-return branch still exists`,
    );
  }
  check(
    shouldAnswerBusinessQueryDirectly("inventory_query") === false,
    "inventory_query is NOT routed to the business-query branch",
  );
  check(
    shouldAnswerBusinessQueryDirectly("staff_query") === false,
    "staff_query is NOT routed to the business-query branch",
  );
  check(
    shouldAnswerBusinessQueryDirectly("location_query") === false,
    "location_query is NOT routed to the business-query branch",
  );

  console.log("(f) unknown intent still falls back to chat");
  check(
    shouldAnswerBusinessQueryDirectly("unknown") === false,
    "unknown intent is NOT answered as a business query",
  );
  check(
    runtimeSource.includes("if (!classification.ok || classification.intent === \"unknown\") {"),
    "unknown classification still detected",
  );
  check(
    runtimeSource.includes("return await this.fallbackToChat(message, context, sessionId, organizationId, profileId);"),
    "unknown intent still falls back to chat",
  );
  check(
    runtimeSource.includes("private async fallbackToChat("),
    "fallbackToChat still exists (now delegates to the direct-answer helper)",
  );

  console.log("(scope) market_intelligence is a separate item, not fixed here");
  check(
    shouldAnswerBusinessQueryDirectly("market_intelligence") === false,
    "market_intelligence is NOT answered directly by this slice",
  );
  check(
    engineSource.includes('requiredFields: ["title", "raw_text"]'),
    "market_intelligence schema still requires title/raw_text (unchanged)",
  );

  console.log("(schema) business_query schema untouched");
  check(
    engineSource.includes('requiredFields: ["question"]'),
    "business_query requiredFields still [\"question\"] (flow bypasses it, schema unchanged)",
  );
  check(
    engineSource.includes('executionFunction: "executeBusinessQuery"'),
    "business_query executionFunction unchanged",
  );

  console.log(`\nAll ${passed} Business Query yes/no checks passed.`);
}

void main();
