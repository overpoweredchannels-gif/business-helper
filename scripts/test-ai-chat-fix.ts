import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chatWithBusinessBrain,
  buildChatResponse,
  BUSINESS_BRAIN_ENDPOINT,
} from "../src/lib/ai/server-chat";
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
  const onBrainChatEnd = pageSource.indexOf("}, []);", onBrainChatStart);
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
    onBrainChatBlock.includes("getBusinessContext()"),
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
}

main()
  .then(() => console.log("test-ai-chat-fix: all assertions passed"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
