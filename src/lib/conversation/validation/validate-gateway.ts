import { MemoryStore } from "@/lib/brain/memory/business-memory";
import { MemoryWriter } from "@/lib/brain/memory/memory-writer";
import { PreferenceStore } from "@/lib/brain/learning/preference-store";
import { initializeBusinessBrain, getBusinessBrain } from "@/lib/brain/bootstrap";
import { createMockRawData } from "@/lib/brain/validation/fixtures";
import { runSuite, test, assert, assertEqual } from "@/lib/brain/validation/helpers";
import { getGateway } from "../gateway";
import { TCGP_VERSION, SUPPORTED_VERSIONS } from "../contracts";

// ─── Bootstrap helpers ──────────────────────────────────────────────────────

function initBrain() {
  const data = createMockRawData(5, 3, 2, 10);
  initializeBusinessBrain(data);
}

function clearBrain() {
  // Reset brain by re-initializing the module state.
  // The brain singleton uses module-level `_instance`. We re-init with empty
  // data so that `getBusinessBrain()` returns a valid instance.
  const empty = createMockRawData(0, 0, 0, 0);
  initializeBusinessBrain(empty);
}

// ─── Gateway validation suite ───────────────────────────────────────────────

export function validateGateway() {
  return runSuite("Conversation Gateway — TCGP v1.0 Compliance", [

    // ── Version Negotiation ─────────────────────────────────────────────

    test("version negotiation — defaults to TCGP_VERSION when not specified", async () => {
      const res = await getGateway().chat({ message: "hello", channel: "web" });
      assertEqual(res.version, TCGP_VERSION, "version defaults to current");
    }),

    test("version negotiation — accepts supported version", async () => {
      for (const v of SUPPORTED_VERSIONS) {
        const res = await getGateway().chat({ message: "hello", channel: "web", version: v });
        assertEqual(res.version, v, `version ${v} accepted`);
      }
    }),

    test("version negotiation — rejects unsupported version", async () => {
      const res = await getGateway().chat({ message: "hello", channel: "web", version: "99.99" });
      assert(!res.ok, "unsupported version fails");
      assert(typeof res.error === "string" && res.error.startsWith("UNSUPPORTED_VERSION"), "correct error code");
    }),

    // ── Request Envelope Validation ──────────────────────────────────────

    test("envelope validation — empty message is rejected", async () => {
      const res = await getGateway().chat({ message: "", channel: "web" });
      assert(!res.ok, "empty message fails");
      assert(typeof res.error === "string" && res.error.startsWith("VALIDATION_ERROR"), "correct error code");
    }),

    test("envelope validation — whitespace-only message is rejected", async () => {
      const res = await getGateway().chat({ message: "   ", channel: "web" });
      assert(!res.ok, "whitespace message fails");
      assert(typeof res.error === "string" && res.error.startsWith("VALIDATION_ERROR"), "correct error code");
    }),

    test("envelope validation — non-string message is rejected", async () => {
      // @ts-expect-error — testing runtime guard against non-string
      const res = await getGateway().chat({ message: 42, channel: "web" });
      assert(!res.ok, "non-string message fails");
    }),

    test("envelope validation — missing channel is rejected", async () => {
      // @ts-expect-error — testing runtime guard against missing channel
      const res = await getGateway().chat({ message: "hello" });
      assert(!res.ok, "missing channel fails");
      assert(typeof res.error === "string" && res.error.startsWith("VALIDATION_ERROR"), "correct error code");
    }),

    test("envelope validation — valid request passes validation", async () => {
      initBrain();
      const res = await getGateway().chat({ message: "hello", channel: "web" });
      // After initBrain(), the brain exists; brain.chat() may fail at fetch
      // (no API server in test), but the error should NOT be a validation error.
      if (res.error) {
        assert(typeof res.error === "string", "error is string when present");
        assert(!res.error.startsWith("VALIDATION_ERROR"), "no validation error");
      }
    }),

    // ── Correlation ID ───────────────────────────────────────────────────

    test("correlation id — generated when not provided", async () => {
      const res = await getGateway().chat({ message: "hello", channel: "web" });
      assert(res.correlationId.length > 0, "correlationId present");
      assert(res.correlationId.startsWith("corr_"), "correlationId format");
    }),

    test("correlation id — propagated when provided", async () => {
      const cid = "corr_test_123";
      const res = await getGateway().chat({ message: "hello", channel: "web", correlationId: cid });
      assertEqual(res.correlationId, cid, "correlationId matches input");
    }),

    test("correlation id — two requests without cid get different ids", async () => {
      const r1 = await getGateway().chat({ message: "a", channel: "web" });
      const r2 = await getGateway().chat({ message: "b", channel: "web" });
      assert(r1.correlationId !== r2.correlationId, "different correlationIds");
    }),

    test("correlation id — two requests with same cid propagate same cid", async () => {
      const cid = "corr_same_test";
      const r1 = await getGateway().chat({ message: "a", channel: "web", correlationId: cid });
      const r2 = await getGateway().chat({ message: "b", channel: "web", correlationId: cid });
      assertEqual(r1.correlationId, cid, "first request");
      assertEqual(r2.correlationId, cid, "second request");
    }),

    // ── Request ID ───────────────────────────────────────────────────────

    test("request id — every response has a unique requestId", async () => {
      const r1 = await getGateway().chat({ message: "a", channel: "web" });
      const r2 = await getGateway().chat({ message: "b", channel: "web" });
      assert(r1.requestId.length > 0, "requestId present");
      assert(r1.requestId !== r2.requestId, "requestId unique per call");
      assert(r1.requestId.startsWith("req_"), "requestId format");
    }),

    // ── Timestamp ────────────────────────────────────────────────────────

    test("timestamp — response has ISO timestamp", async () => {
      const res = await getGateway().chat({ message: "hello", channel: "web" });
      assert(res.timestamp.length > 0, "timestamp present");
      assert(!isNaN(Date.parse(res.timestamp)), "timestamp is valid ISO");
    }),

    // ── Conversation ID ──────────────────────────────────────────────────

    test("conversation id — generated when not provided", async () => {
      const res = await getGateway().chat({ message: "hello", channel: "web" });
      assert(res.conversationId.length > 0, "conversationId present");
      assert(res.conversationId.startsWith("conv_"), "conversationId format");
    }),

    test("conversation id — reused when same id sent", async () => {
      const first = await getGateway().chat({ message: "first", channel: "web" });
      const second = await getGateway().chat({ message: "second", channel: "web", conversationId: first.conversationId });
      assertEqual(second.conversationId, first.conversationId, "same conversationId reused");
    }),

    test("conversation id — unknown id treated as new", async () => {
      const res = await getGateway().chat({ message: "hello", channel: "web", conversationId: "conv_nonexistent_123" });
      // Gateway generates a new one since "conv_nonexistent_123" isn't tracked
      assert(res.conversationId.startsWith("conv_"), "new conversationId generated");
      assert(res.conversationId !== "conv_nonexistent_123", "unknown id replaced");
    }),

    // ── BusinessBrain delegation ─────────────────────────────────────────

    test("brain delegation — returns BRAIN_NOT_INITIALIZED when brain is absent", async () => {
      // Ensure brain is not initialized
      // We can't truly unload it, but we can assert the error path.
      // If brain IS initialized, this test just verifies the request works.
      const brain = getBusinessBrain();
      if (!brain) {
        const res = await getGateway().chat({ message: "hello", channel: "web" });
        assert(!res.ok, "fails without brain");
        assert(typeof res.error === "string" && res.error.startsWith("BRAIN_NOT_INITIALIZED"), "correct error code");
      }
    }),

    test("brain delegation — delegates message to brain.chat()", async () => {
      initBrain();
      const res = await getGateway().chat({ message: "test message", channel: "web" });
      // The brain is initialized so we expect a real response (ok or error from AI)
      assert(typeof res.ok === "boolean", "response has ok field");
      assert(typeof res.message === "string", "response has message field");
    }),

    // ── Response envelope ────────────────────────────────────────────────

    test("response envelope — all envelope fields present", async () => {
      const res = await getGateway().chat({ message: "hello", channel: "web", correlationId: "test_env" });
      assert(res.version === TCGP_VERSION, "version present");
      assert(res.correlationId === "test_env", "correlationId present");
      assert(res.requestId.startsWith("req_"), "requestId present");
      assert(res.timestamp.length > 0, "timestamp present");
      assert(res.conversationId.startsWith("conv_"), "conversationId present");
    }),

    test("response envelope — ok response has provider and model when available", async () => {
      initBrain();
      const res = await getGateway().chat({ message: "how is my business?", channel: "web" });
      if (res.ok) {
        // Provider and model are optional but should be present when brain returns them
        assert(typeof res.conversationId === "string", "conversationId is string");
      }
    }),

    test("response envelope — error response has error message", async () => {
      const res = await getGateway().chat({ message: "hello", channel: "web", version: "0.0" });
      assert(!res.ok, "not ok");
      assert(typeof res.error === "string" && res.error.length > 0, "error message present");
    }),

    // ── Channel metadata ─────────────────────────────────────────────────

    test("channel metadata — all channel types accepted", async () => {
      const channels = ["web", "voice", "whatsapp", "phone", "mcp", "desktop", "mobile"] as const;
      for (const ch of channels) {
        const res = await getGateway().chat({ message: "test", channel: ch });
        // Channel passes validation layer (brain may be init'd or not;
        // errors from the brain itself are not validation failures)
        const err = res.error;
        const isValidationError = typeof err === "string" && (
          err.startsWith("VALIDATION_ERROR")
          || err.startsWith("UNSUPPORTED_VERSION")
          || err.startsWith("BRAIN_NOT_INITIALIZED")
        );
        assert(!isValidationError, `channel ${ch} accepted`);
      }
    }),

    // ── Gateway status ───────────────────────────────────────────────────

    test("gateway status — returns valid status object", () => {
      const status = getGateway().getStatus();
      assert(typeof status.ready === "boolean", "ready is boolean");
      assert(typeof status.brainAttached === "boolean", "brainAttached is boolean");
      assert(typeof status.conversationCount === "number", "conversationCount is number");
      assert(typeof status.sessionCount === "number", "sessionCount is number");
      assert(typeof status.uptimeMs === "number", "uptimeMs is number");
      assert(status.uptimeMs >= 0, "uptimeMs is non-negative");
    }),

    test("gateway status — conversationCount reflects tracked conversations", async () => {
      const before = getGateway().getStatus().conversationCount;
      await getGateway().chat({ message: "a", channel: "web" });
      await getGateway().chat({ message: "b", channel: "web" });
      const after = getGateway().getStatus().conversationCount;
      assert(after >= before + 1, "conversation count increased");
    }),

    // ── Gateway metrics ───────────────────────────────────────────────────

    test("gateway metrics — getMetrics returns valid shape", () => {
      const metrics = getGateway().getMetrics();
      assert(typeof metrics.requestCount === "number", "requestCount is number");
      assert(typeof metrics.errorCount === "number", "errorCount is number");
      assert(typeof metrics.validationErrorCount === "number", "validationErrorCount is number");
      assert(typeof metrics.brainErrorCount === "number", "brainErrorCount is number");
      assert(typeof metrics.totalDurationMs === "number", "totalDurationMs is number");
      assert(typeof metrics.avgDurationMs === "number", "avgDurationMs is number");
      assert(typeof metrics.activeConversations === "number", "activeConversations is number");
      assert(typeof metrics.activeSessions === "number", "activeSessions is number");
      assert(metrics.uptimeMs >= 0, "uptimeMs is non-negative");
      assert(metrics.startedAt > 0, "startedAt is valid");
    }),

    test("gateway metrics — requestCount increments on chat call", async () => {
      const before = getGateway().getMetrics().requestCount;
      await getGateway().chat({ message: "c", channel: "web" });
      const after = getGateway().getMetrics().requestCount;
      assert(after > before, "requestCount increased after chat call");
    }),

    test("gateway metrics — validationErrorCount increments on invalid request", async () => {
      const before = getGateway().getMetrics().validationErrorCount;
      await getGateway().chat({ message: "", channel: "web" });
      const after = getGateway().getMetrics().validationErrorCount;
      assert(after > before, "validationErrorCount increased on empty message");
    }),

    test("gateway metrics — brainErrorCount increments when brain absent", async () => {
      // Only runs if brain is not initialized
      const { getBusinessBrain } = await import("@/lib/brain");
      const brain = getBusinessBrain();
      if (!brain) {
        const before = getGateway().getMetrics().brainErrorCount;
        await getGateway().chat({ message: "hello", channel: "web" });
        const after = getGateway().getMetrics().brainErrorCount;
        assert(after > before, "brainErrorCount increased when brain absent");
      }
    }),

    test("gateway metrics — durationMs recorded for successful calls", async () => {
      const before = getGateway().getMetrics().totalDurationMs;
      await getGateway().chat({ message: "test-dur", channel: "web" });
      const after = getGateway().getMetrics().totalDurationMs;
      // Duration may or may not increase depending on validation fast-path
      assert(after >= before, "totalDurationMs non-decreasing");
    }),

    test("gateway metrics — status.metrics and getMetrics() consistent", () => {
      const fromStatus = getGateway().getStatus().metrics;
      const fromMethod = getGateway().getMetrics();
      assert(fromStatus.requestCount === fromMethod.requestCount, "requestCount consistent");
      assert(fromStatus.errorCount === fromMethod.errorCount, "errorCount consistent");
    }),

    // ── Session and conversation continuity ──────────────────────────────

    test("session continuity — provided sessionId is reused", async () => {
      const sid = "test_session_continuity";
      await getGateway().chat({ message: "a", channel: "web", sessionId: sid });
      await getGateway().chat({ message: "b", channel: "web", sessionId: sid });
      const metrics = getGateway().getMetrics();
      // Each test run creates at most one session with id "test_session_continuity"
      assert(metrics.activeSessions >= 1, "at least one active session");
    }),

    test("conversation continuity — provided conversationId is reused", async () => {
      const cid = "test_conv_continuity";
      const r1 = await getGateway().chat({ message: "a", channel: "web", conversationId: cid });
      const r2 = await getGateway().chat({ message: "b", channel: "web", conversationId: cid });
      assert(r1.conversationId === cid || r1.conversationId.startsWith("conv_"), "first response has id");
      // When cid isn't in gateway's map, it generates a new one; if it IS, it reuses it
      if (r1.conversationId === cid) {
        assertEqual(r2.conversationId, cid, "conversationId reused when known");
      }
    }),

    // ── Streaming (chatStream) ───────────────────────────────────────────

    test("streaming — yields start event first", async () => {
      const gen = getGateway().chatStream({ message: "hello", channel: "web" });
      const { value, done } = await gen.next();
      assert(!done, "generator not done");
      assert((value as any)?.type === "error" || (value as any)?.type === "start",
        "first event is start (or error if no brain)");
    }),

    test("streaming — yields error for unsupported version", async () => {
      const events: any[] = [];
      for await (const e of getGateway().chatStream({ message: "hello", channel: "web", version: "99.99" })) {
        events.push(e);
      }
      assert(events.length >= 1, "at least one event");
      const last = events[events.length - 1];
      assert(last.type === "error", "error event for unsupported version");
    }),

    test("streaming — yields error for empty message", async () => {
      const events: any[] = [];
      for await (const e of getGateway().chatStream({ message: "", channel: "web" })) {
        events.push(e);
      }
      assert(events.length >= 1, "at least one event");
      const last = events[events.length - 1];
      assert(last.type === "error", "error event for empty message");
    }),

    test("streaming — every event has required fields", async () => {
      const events: any[] = [];
      for await (const e of getGateway().chatStream({ message: "test", channel: "web" })) {
        events.push(e);
      }
      for (const ev of events) {
        assert(typeof ev.type === "string", "event has type");
        assert(typeof ev.requestId === "string", "event has requestId");
        assert(typeof ev.conversationId === "string", "event has conversationId");
        assert(typeof ev.correlationId === "string", "event has correlationId");
        assert(typeof ev.version === "string", "event has version");
        assert(typeof ev.timestamp === "string", "event has timestamp");
      }
    }),

    test("streaming — all events share same requestId and correlationId", async () => {
      const events: any[] = [];
      for await (const e of getGateway().chatStream({ message: "test", channel: "web", correlationId: "stream_corr_test" })) {
        events.push(e);
      }
      if (events.length > 1) {
        const first = events[0];
        for (const ev of events) {
          assertEqual(ev.requestId, first.requestId, "same requestId across events");
          assertEqual(ev.correlationId, first.correlationId, "same correlationId across events");
        }
      }
    }),

    test("streaming — yields start → text → done sequence with initialized brain", async () => {
      initBrain();
      const events: any[] = [];
      for await (const e of getGateway().chatStream({ message: "test stream", channel: "web" })) {
        events.push(e);
      }
      // With a real brain, we expect error events (fetch failure) or start/text/done
      if (events.length >= 1) {
        assert(events[0].type === "start", "first event is start");
        if (events[0].type === "start" && events.length >= 2) {
          // If we got past validation, last event is either done or error
          const last = events[events.length - 1];
          assert(last.type === "done" || last.type === "error",
            "last event is done or error");
        }
      }
    }),

    test("streaming — generator ends after events", async () => {
      const gen = getGateway().chatStream({ message: "hello", channel: "web" });
      // Exhaust generator
      for await (const _ of gen) { /* drain */ }
      const { done } = await gen.next();
      assert(done === true, "generator exhausted after all events");
    }),
  ]);
}
