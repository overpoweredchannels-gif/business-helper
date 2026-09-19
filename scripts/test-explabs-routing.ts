import assert from "node:assert/strict";
import { callAiProviderRouter } from "../src/lib/ai/provider-router";

async function main() {
  const originalFetch = globalThis.fetch;
  const names = ["AI_PROVIDER_ORDER", "AI_MAX_RETRIES_PER_PROVIDER", "OPENAI_PRIMARY_MODEL", "OPENAI_MODEL", "OPENAI_FALLBACK_MODEL", "OPENAI_API_KEY", "EXPLABS_API_KEY"];
  const originalEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const run = () => callAiProviderRouter({ task: "routing test", prompt: "Reply ok" });
  try {
    for (const name of names) delete process.env[name];
    process.env.AI_PROVIDER_ORDER = "openai";
    process.env.OPENAI_PRIMARY_MODEL = "gpt-5.6-luna";
    process.env.EXPLABS_API_KEY = "test-gateway-key";
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } }), { status: 200 });
    };
    const luna = await run();
    assert.equal(luna.ok, true);
    assert.equal(luna.text, "ok");
    assert.equal(luna.raw.usage.total_tokens, 5);
    assert.equal(requests[0].url, "https://api.experientiallabs.ai/v1/chat/completions");
    assert.equal(new Headers(requests[0].init.headers).get("Authorization"), "Bearer test-gateway-key");
    assert.equal(requests[0].body.model, "gpt-5.6-luna");
    assert.deepEqual(requests[0].body.messages, [{ role: "user", content: "Task: routing test\n\nReply ok" }]);

    process.env.OPENAI_API_KEY = "test-direct-key";
    await run();
    assert.equal(new Headers(requests[1].init.headers).get("Authorization"), "Bearer test-gateway-key");
    delete process.env.EXPLABS_API_KEY;
    process.env.OPENAI_FALLBACK_MODEL = "gpt-5.4-mini";
    const missing = await run();
    assert.equal(missing.ok, false);
    assert.match(missing.error!, /EXPLABS_API_KEY is required/);
    assert.equal(requests.length, 2, "Missing gateway key must not send Luna or a fallback request");

    process.env.OPENAI_PRIMARY_MODEL = "gpt-5.4-mini";
    delete process.env.OPENAI_FALLBACK_MODEL;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-direct-key");
      return new Response(JSON.stringify({ output_text: "direct ok" }), { status: 200 });
    };
    assert.equal((await run()).text, "direct ok", "Other model routes remain unchanged");

    process.env.OPENAI_FALLBACK_MODEL = "gpt-5.6-luna";
    process.env.EXPLABS_API_KEY = "test-gateway-key";
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("api.openai.com")) return new Response("unavailable", { status: 503 });
      assert.equal(String(url), "https://api.experientiallabs.ai/v1/chat/completions");
      assert.equal(JSON.parse(String(init?.body)).model, "gpt-5.6-luna");
      return new Response(JSON.stringify({ choices: [{ message: { content: "fallback ok" } }] }), { status: 200 });
    };
    assert.equal((await run()).text, "fallback ok", "Luna fallback also uses the gateway");
    console.log("Experiential routing passed: Luna primary/fallback, correct credential, missing-key stop, usage retention and unchanged other models.");
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
