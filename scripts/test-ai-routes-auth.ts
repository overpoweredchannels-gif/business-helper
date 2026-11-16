import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NextRequest } from "next/server";
import { requireAuthenticatedOrg } from "../src/lib/identity/authorization";
import { POST as businessBrainPOST } from "../src/app/api/business-brain/route";
import { POST as conversationChatPOST } from "../src/app/api/conversation/chat/route";
import { POST as conversationStreamPOST } from "../src/app/api/conversation/chat/stream/route";
import { GET as conversationStatusGET } from "../src/app/api/conversation/status/route";

// AI routes auth (P0-5, 2026-11-16). Four AI routes answered without any
// authentication — POST /api/business-brain (IP rate-limit only), POST
// /api/conversation/chat, POST /api/conversation/chat/stream and GET
// /api/conversation/status — so anyone on the internet could spend LLM
// calls and read gateway state. The fix requires a signed-in user with an
// organization on every one of them (owner or staff; the AI chat is used
// by staff too, so this is deliberately NOT owner-only), failing closed
// with 401 when there is no session. The browser chat sends its session
// token via authorizedFetch. Code-level only: no live Supabase or LLM
// call is made — the no-token path returns before any network call.

function noAuthRequest(url: string, method: string): NextRequest {
  return new Request(url, { method }) as unknown as NextRequest;
}

async function main(): Promise<void> {
  // --- (1) The helper fails closed with 401 when there is no session. ---
  // resolveActor returns early on a missing Authorization header, before
  // any Supabase call — so this exercises the real code path offline.
  const noAuth = await requireAuthenticatedOrg(
    new Request("http://localhost/api/business-brain", { method: "POST" })
  );
  assert.equal(noAuth.ok, false, "a request with no token is not authenticated");
  if (noAuth.ok === false) {
    assert.equal(noAuth.status, 401, "no token gets 401, not 403 and not a pass-through");
    assert.match(noAuth.error, /Authentication required/, "401 names authentication");
  }

  // --- (2) Every route answers 401 to an unauthenticated request. ---
  // Each handler must reject before doing any work (no rate-limit spend,
  // no LLM call, no gateway call, no body parse).

  const brain = await businessBrainPOST(
    noAuthRequest("http://localhost/api/business-brain", "POST")
  );
  assert.equal(brain.status, 401, "business-brain without a token is 401");
  assert.match(
    String((await brain.json() as { error?: unknown }).error ?? ""),
    /Authentication required/,
    "business-brain 401 names authentication"
  );

  const chat = await conversationChatPOST(
    noAuthRequest("http://localhost/api/conversation/chat", "POST")
  );
  assert.equal(chat.status, 401, "conversation/chat without a token is 401");
  const chatBody = (await chat.json()) as { ok?: unknown; error?: unknown };
  assert.equal(chatBody.ok, false, "conversation/chat 401 is not a success");
  assert.match(String(chatBody.error ?? ""), /Authentication required/);

  const stream = await conversationStreamPOST(
    noAuthRequest("http://localhost/api/conversation/chat/stream", "POST")
  );
  assert.equal(stream.status, 401, "conversation/chat/stream without a token is 401");
  assert.match(
    String((await stream.json() as { error?: unknown }).error ?? ""),
    /Authentication required/,
    "stream 401 names authentication (plain JSON, not SSE)"
  );

  const status = await conversationStatusGET(
    noAuthRequest("http://localhost/api/conversation/status", "GET")
  );
  assert.equal(status.status, 401, "conversation/status without a token is 401");
  assert.match(
    String((await status.json() as { error?: unknown }).error ?? ""),
    /Authentication required/
  );

  // --- (3) Auth runs before any work in every route (source order). ---
  const brainSource = readFileSync("src/app/api/business-brain/route.ts", "utf8");
  const brainAuthAt = brainSource.indexOf("requireAuthenticatedOrg(req)");
  assert.ok(brainAuthAt >= 0, "business-brain calls requireAuthenticatedOrg");
  assert.ok(
    brainAuthAt < brainSource.indexOf("checkRateLimit(`"),
    "business-brain authenticates before rate limiting"
  );
  assert.ok(
    brainAuthAt < brainSource.indexOf("callAiProviderRouter({"),
    "business-brain authenticates before spending an LLM call"
  );

  const chatSource = readFileSync("src/app/api/conversation/chat/route.ts", "utf8");
  const chatAuthAt = chatSource.indexOf("requireAuthenticatedOrg(request)");
  assert.ok(chatAuthAt >= 0, "conversation/chat calls requireAuthenticatedOrg");
  assert.ok(
    chatAuthAt < chatSource.indexOf("getGateway().chat"),
    "conversation/chat authenticates before calling the gateway"
  );

  const streamSource = readFileSync("src/app/api/conversation/chat/stream/route.ts", "utf8");
  const streamAuthAt = streamSource.indexOf("requireAuthenticatedOrg(req)");
  assert.ok(streamAuthAt >= 0, "conversation/chat/stream calls requireAuthenticatedOrg");
  assert.ok(
    streamAuthAt < streamSource.indexOf("getGateway()"),
    "conversation/chat/stream authenticates before calling the gateway"
  );

  const statusSource = readFileSync("src/app/api/conversation/status/route.ts", "utf8");
  const statusAuthAt = statusSource.indexOf("requireAuthenticatedOrg(request)");
  assert.ok(statusAuthAt >= 0, "conversation/status calls requireAuthenticatedOrg");
  assert.ok(
    statusAuthAt < statusSource.indexOf("getGateway().getStatus()"),
    "conversation/status authenticates before reading gateway state"
  );

  // --- (4) The helper's status mapping is fail-closed and complete. ---
  const authSource = readFileSync("src/lib/identity/authorization.ts", "utf8");
  const helperAt = authSource.indexOf("requireAuthenticatedOrg");
  assert.ok(helperAt >= 0, "requireAuthenticatedOrg exists");
  const helperBlock = authSource.slice(helperAt);
  assert.ok(
    helperBlock.includes("status: 401"),
    "no session maps to 401"
  );
  assert.ok(
    helperBlock.includes("status: 403"),
    "a session without an organization maps to 403"
  );
  assert.ok(
    helperBlock.includes("status: 500"),
    "an unresolvable actor context maps to 500, not a pass-through"
  );
  assert.ok(
    helperBlock.includes("requireOrganization(request)"),
    "the helper reuses the existing requireOrganization, not a new mechanism"
  );

  // --- (5) The browser chat sends its session token. ---
  // server-chat.ts must default to authorizedFetch (Bearer token from the
  // browser session), not bare fetch — otherwise the newly-authenticated
  // route would 401 the signed-in owner and the AI chat would break.
  const serverChatSource = readFileSync("src/lib/ai/server-chat.ts", "utf8");
  assert.ok(
    serverChatSource.includes("authorizedFetch"),
    "server-chat.ts uses authorizedFetch"
  );
  assert.ok(
    /chatWithBusinessBrain\([\s\S]*?=\s*authorizedFetch/.test(serverChatSource),
    "authorizedFetch is the default transport for the browser chat"
  );
  assert.ok(
    !/chatWithBusinessBrain\([\s\S]*?=\s*fetch\s*[,)]/.test(serverChatSource),
    "the browser chat no longer defaults to bare fetch"
  );
  const authedFetchSource = readFileSync("src/lib/tradeos/authorized-fetch.ts", "utf8");
  assert.ok(
    authedFetchSource.includes('headers.set("Authorization", `Bearer ${token}`)'),
    "authorizedFetch attaches the session token as a Bearer header"
  );
  assert.ok(
    authedFetchSource.includes("supabase.auth.getSession()"),
    "authorizedFetch reads the token from the browser session"
  );

  // --- (6) No route is left unauthenticated. ---
  for (const [name, source] of [
    ["business-brain", brainSource],
    ["conversation/chat", chatSource],
    ["conversation/chat/stream", streamSource],
    ["conversation/status", statusSource],
  ] as const) {
    assert.ok(
      source.includes("requireAuthenticatedOrg"),
      `${name} is protected by requireAuthenticatedOrg`
    );
    assert.ok(
      !source.includes("getGateway().chat") || source.includes("requireAuthenticatedOrg"),
      `${name} never reaches the gateway without auth`
    );
  }

  console.log("AI routes auth tests passed: unauthenticated requests get 401 on all four routes, auth runs before any work, and the browser chat sends its session token.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
