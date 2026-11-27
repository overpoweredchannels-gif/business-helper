import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chatWithBusinessBrain,
  buildChatResponse,
  BUSINESS_BRAIN_ENDPOINT,
} from "../src/lib/ai/server-chat";
import {
  cleanChatHistoryForPrompt,
  isStaleAssistantReply,
  STALE_ASSISTANT_REPLIES,
  MAX_CHAT_HISTORY_TURNS,
} from "../src/lib/ai/chat-history-hygiene";
import { initializeBusinessBrain, getBusinessBrain } from "../src/lib/brain/bootstrap";
import { createMockRawData } from "../src/lib/brain/validation/fixtures";

// AI chat fix (2026-11-16). The in-browser AI chat called the LLM provider
// router directly from a "use client" page, where the server-only API keys
// do not exist — so every provider yielded zero models and every message
// failed. The fix routes the browser chat through the /api/business-brain
// server route (which holds the keys) and removes the echo-back fallback
// that returned the user's own message as a successful reply when no
// business data was loaded. Code-level only: no live LLM call is made.

async function main(): Promise<void> {
  // --- (1) The browser chat path no longer calls the provider router. ---
  // onBrainChat in page.tsx must go through the server-chat helper, not the
  // in-browser gateway (whose brain calls callAiProviderRouter with no keys).
  const pageSource = readFileSync("src/app/page.tsx", "utf8");
  const onBrainChatStart = pageSource.indexOf("const onBrainChat");
  assert.ok(onBrainChatStart >= 0, "onBrainChat exists in page.tsx");
  const onBrainChatEnd = pageSource.indexOf("\n  const buildAnalyticsContext", onBrainChatStart);
  assert.ok(onBrainChatEnd > onBrainChatStart, "onBrainChat block ends");
  const onBrainChatBlock = pageSource.slice(onBrainChatStart, onBrainChatEnd);
  assert.ok(
    onBrainChatBlock.includes("chatWithBusinessBrain"),
    "onBrainChat calls the server-chat helper"
  );
  assert.ok(
    !onBrainChatBlock.includes("getGateway().chat"),
    "onBrainChat no longer goes through the in-browser gateway"
  );
  assert.ok(
    !onBrainChatBlock.includes("callAiProviderRouter"),
    "onBrainChat never calls the provider router directly"
  );
  assert.ok(
    onBrainChatBlock.includes("getBusinessContext(buildCurrentAssistantKpiBlock())"),
    "onBrainChat sends the loaded business context to the server"
  );
  assert.ok(
    onBrainChatBlock.includes("conversationHistory"),
    "onBrainChat sends recent turns to the server"
  );
  assert.ok(
    !pageSource.includes("callAiProviderRouter"),
    "page.tsx never imports the provider router anywhere"
  );

  // --- (2) The chat calls the server route. ---
  // The helper itself must be browser-safe: no provider-router import, and
  // a POST to /api/business-brain. The server route holds the keys.
  const serverChatSource = readFileSync("src/lib/ai/server-chat.ts", "utf8");
  assert.ok(
    !serverChatSource.includes("callAiProviderRouter"),
    "server-chat.ts never calls the provider router"
  );
  assert.ok(
    !serverChatSource.includes("provider-router"),
    "server-chat.ts never imports the provider router"
  );
  assert.equal(BUSINESS_BRAIN_ENDPOINT, "/api/business-brain");
  assert.ok(
    serverChatSource.includes('method: "POST"'),
    "server-chat.ts POSTs to the server route"
  );
  const routeSource = readFileSync("src/app/api/business-brain/route.ts", "utf8");
  assert.ok(routeSource.includes("export async function POST"), "business-brain route exists");
  assert.ok(
    routeSource.includes("callAiProviderRouter"),
    "the server route (not the browser) calls the provider router"
  );
  assert.ok(
    routeSource.includes("checkRateLimit"),
    "the server route keeps its rate limiting"
  );

  // The hook passes recent turns through so follow-ups keep context.
  const hookSource = readFileSync("src/hooks/useAIChat.ts", "utf8");
  assert.ok(hookSource.includes("history?:"), "ChatContext carries recent history");
  assert.ok(hookSource.includes("messagesRef"), "history is built from on-screen messages");

  // --- (3) No-data state does not echo the user's message. ---
  const bootstrapSource = readFileSync("src/lib/brain/bootstrap.ts", "utf8");
  assert.ok(
    !bootstrapSource.includes("return { ok: true, message: message }"),
    "the echo-back fallback is gone from bootstrap.ts"
  );
  assert.ok(
    bootstrapSource.includes("No business data is loaded yet"),
    "the no-data state reports an honest error"
  );

  // Behaviour: a brain initialised with no organisation id must fail
  // honestly instead of returning the user's own words as a success.
  // (createMockRawData(0, 0, 0, 0) crashes inside the fixture itself —
  // suppliers[i % 0] — so use minimal counts and override the org id.)
  const emptyData = { ...createMockRawData(1, 1, 1, 1), organizationId: "" };
  initializeBusinessBrain(emptyData);
  const brain = getBusinessBrain();
  assert.ok(brain, "brain initialises with empty data");
  const noData = await brain.chat("How many products do I have?");
  assert.equal(noData.ok, false, "no-data chat is not a success");
  assert.notEqual(
    noData.message,
    "How many products do I have?",
    "no-data chat does not echo the user message"
  );
  assert.match(noData.error ?? "", /no business data/i, "no-data error names the cause");

  // --- (4) A mocked server response flows through to the UI shape. ---
  const okFetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      message: "You have 42 products in stock.",
      provider: "gemini",
      model: "gemini-flash-latest",
    }),
  })) as unknown as typeof fetch;
  const okResult = await chatWithBusinessBrain(
    { message: "How many products do I have?" },
    okFetch
  );
  assert.equal(okResult.ok, true, "mocked server success flows through");
  assert.equal(okResult.message, "You have 42 products in stock.");
  assert.equal(okResult.provider, "gemini");
  assert.equal(okResult.model, "gemini-flash-latest");

  const chatResponse = buildChatResponse(okResult, {
    conversationId: "conv_test_1",
    correlationId: "corr_test_1",
  });
  assert.equal(chatResponse.ok, true, "ChatResponse is ok");
  assert.equal(chatResponse.message, "You have 42 products in stock.");
  assert.equal(chatResponse.conversationId, "conv_test_1");
  assert.equal(chatResponse.correlationId, "corr_test_1");
  assert.equal(chatResponse.provider, "gemini");
  assert.equal(chatResponse.model, "gemini-flash-latest");
  assert.equal(chatResponse.version, "1.0");

  // A server-side provider failure surfaces as an honest error, not a
  // fake success and not the user's own message.
  const errorFetch = (async () => ({
    ok: false,
    status: 502,
    json: async () => ({ ok: false, error: "No configured AI providers were available." }),
  })) as unknown as typeof fetch;
  const errResult = await chatWithBusinessBrain({ message: "hello" }, errorFetch);
  assert.equal(errResult.ok, false, "server error is not a success");
  assert.match(errResult.error ?? "", /No configured AI providers/);
  const errResponse = buildChatResponse(errResult, { conversationId: "conv_test_2" });
  assert.equal(errResponse.ok, false);
  assert.equal(errResponse.message, "");
  assert.ok((errResponse.error ?? "").length > 0, "error response carries an error");

  // A network failure is an honest error too.
  const failingFetch = (async () => {
    throw new Error("fetch failed");
  }) as unknown as typeof fetch;
  const netResult = await chatWithBusinessBrain({ message: "hello" }, failingFetch);
  assert.equal(netResult.ok, false, "network failure is not a success");
  assert.match(netResult.error ?? "", /Could not reach/);

  // --- (5) Poisoned history is cleaned before it reaches the model. ---
  // Live QA on 947d92d: the stored history already held the legacy
  // runtime's verbatim failure replies, the model continued that voice,
  // and each echoed failure was saved and re-sent — a self-reinforcing
  // loop. The route must drop those pairs (and the stale-error prompt
  // line must tell the model to ignore them).
  assert.equal(STALE_ASSISTANT_REPLIES.length, 4, "four known stale replies");
  for (const stale of STALE_ASSISTANT_REPLIES) {
    assert.equal(isStaleAssistantReply(stale), true, `stale reply recognised: ${stale.slice(0, 30)}…`);
  }
  // presentConfirmation appends the yes/no line to a summary, so a stale
  // reply can carry extra framing around the known string.
  assert.equal(
    isStaleAssistantReply("Sale summary: 2 items, total €1.13.\n\nPlease confirm with yes or no."),
    true,
    "suffixed yes/no confirmation is stale too"
  );
  assert.equal(isStaleAssistantReply("You have 78 products in stock."), false, "a real answer is not stale");
  assert.equal(isStaleAssistantReply(""), false, "empty text is not stale");

  // Fixture: the exact poisoned history from the live QA — three failed
  // pairs, then one good pair. Only the good pair may survive.
  const poisonedHistory = [
    { role: "user" as const, text: "How many products do I have?" },
    { role: "assistant" as const, text: "Sorry, I couldn't process that. Can you please rephrase?" },
    { role: "user" as const, text: "How many products do I have?" },
    {
      role: "assistant" as const,
      text: "The previous operation failed. Would you like to try again? Say yes to restart or tell me something else.",
    },
    { role: "user" as const, text: "What is my total revenue this month?" },
    { role: "assistant" as const, text: "Please confirm with yes or no." },
    { role: "user" as const, text: "How many products do I have?" },
    { role: "assistant" as const, text: "You have 78 products in stock." },
  ];
  const cleaned = cleanChatHistoryForPrompt(poisonedHistory);
  assert.deepEqual(
    cleaned,
    [
      { role: "user", text: "How many products do I have?" },
      { role: "assistant", text: "You have 78 products in stock." },
    ],
    "poisoned pairs are dropped, the good pair survives"
  );
  const cleanedText = cleaned.map((m) => m.text).join("\n");
  for (const stale of STALE_ASSISTANT_REPLIES) {
    assert.ok(!cleanedText.includes(stale), `cleaned history holds no stale string: ${stale.slice(0, 30)}…`);
  }

  // A user turn whose assistant reply was stale is dropped WITH it —
  // the pair contains no successful answer.
  const orphaned = cleanChatHistoryForPrompt([
    { role: "user" as const, text: "How many products do I have?" },
    { role: "assistant" as const, text: "The conversation timed out. Please tell me what you'd like to do again." },
    { role: "user" as const, text: "And how many are low in stock?" },
    { role: "assistant" as const, text: "3 products are low in stock." },
  ]);
  assert.deepEqual(
    orphaned,
    [
      { role: "user", text: "And how many are low in stock?" },
      { role: "assistant", text: "3 products are low in stock." },
    ],
    "the timed-out question is dropped with its stale reply"
  );

  // A trailing user turn with no assistant reply is dropped, and the
  // history is capped without splitting a pair.
  const capped = cleanChatHistoryForPrompt(
    Array.from({ length: 5 }, (_, i) => [
      { role: "user" as const, text: `Question ${i + 1}?` },
      { role: "assistant" as const, text: `Answer ${i + 1}.` },
    ]).flat().concat([{ role: "user" as const, text: "Unanswered follow-up?" }])
  );
  assert.equal(capped.length, MAX_CHAT_HISTORY_TURNS, "history is capped to 6 turns");
  assert.equal(capped[0].role, "user", "the cap never opens mid-pair");
  assert.equal(capped[0].text, "Question 3?", "the cap keeps the last three pairs");
  assert.ok(!capped.some((m) => m.text === "Unanswered follow-up?"), "trailing unanswered turn is dropped");

  // The route actually uses the hygiene filter, gives the function room
  // to finish, tells the model to ignore stale errors, and formats money
  // in the org's books currency — not a hardcoded PKR.
  assert.ok(
    routeSource.includes("cleanChatHistoryForPrompt"),
    "the route cleans history before building the prompt"
  );
  assert.ok(routeSource.includes("export const maxDuration = 60"), "the route sets maxDuration 60");
  assert.ok(
    !routeSource.includes("Use PKR currency formatting"),
    "the route no longer hardcodes PKR formatting"
  );
  assert.ok(
    routeSource.includes("booksCurrency"),
    "the route formats money in the org's books currency"
  );
  assert.ok(
    routeSource.includes("stale error"),
    "the prompt tells the model to ignore stale failure turns"
  );
  assert.ok(
    serverChatSource.includes("booksCurrency"),
    "the server-chat helper carries the books currency to the route"
  );
  assert.ok(
    onBrainChatBlock.includes("booksCurrency"),
    "onBrainChat sends the org's books currency"
  );

  // --- (6) Retry sends history from the sliced list, not a stale ref. ---
  // retry() used to call buildContext() synchronously after setMessages,
  // while messagesRef still held the pre-slice turns — so the failed
  // assistant reply was sent as history on the retry (the attempt-4
  // anomaly in the live QA). It must build context from the sliced list.
  const retryStart = hookSource.indexOf("const retry = useCallback");
  assert.ok(retryStart >= 0, "retry exists in useAIChat.ts");
  const retryEnd = hookSource.indexOf("}, [messages, onChat", retryStart);
  assert.ok(retryEnd > retryStart, "retry block ends");
  const retryBlock = hookSource.slice(retryStart, retryEnd);
  assert.ok(
    retryBlock.includes("buildContext(retryHistory)"),
    "retry builds context from the sliced list"
  );
  assert.ok(
    !retryBlock.includes("const ctx = buildContext();"),
    "retry never reads the stale messagesRef"
  );
  assert.ok(
    retryBlock.includes("messages.slice(0, msgIndex - 1)"),
    "retry history excludes the failed assistant reply and the retried user message"
  );
  assert.ok(
    hookSource.includes("messagesOverride"),
    "buildContext accepts an explicit message list"
  );
}

main()
  .then(() => console.log("test-ai-chat-fix: all assertions passed"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
