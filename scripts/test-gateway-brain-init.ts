/**
 * Gateway Business Brain server-side init (P1 Area J) — Unit Tests.
 *
 * Defect (live QA 2026-11-19): POST /api/conversation/chat returned 503
 * BRAIN_NOT_INITIALIZED on every request — auth (401) and channel (422)
 * both passed, so the test method was correct and the route itself was
 * dead. Root cause: the Business Brain is an in-memory singleton
 * (src/lib/brain/bootstrap.ts) set only by initializeBusinessBrain, whose
 * only production caller is bootstrapOrganizationData in the browser
 * (page.tsx). The server route never initialized a brain, so
 * getBusinessBrain() was always null on Vercel and gateway.ts:174
 * returned 503 for EVERY request.
 *
 * Fix: the route loads the org's raw business data server-side and
 * initializes the brain before calling the gateway, via
 * ensureServerBusinessBrain (src/lib/conversation/server-brain.ts) —
 * the same loadRawBusinessData pattern the sibling AI routes use. A
 * failed load fails honestly with the same 503 code, never a fake
 * answer.
 *
 * This test imports the production helper and gateway directly (no
 * mirroring) and asserts the wiring on the real route source. It runs
 * the gateway with NO LLM keys configured, so the runtime answers
 * through its honest no-provider fallback — the assertion is that the
 * request gets PAST the brain check (ok, real message), not that an
 * LLM answers.
 *
 * Run: npx tsx scripts/test-gateway-brain-init.ts
 */

import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getGateway } from "../src/lib/conversation/gateway";
import { getBusinessBrain } from "../src/lib/brain/bootstrap";
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

const ownerActor: ActorContext = {
  profileId: PROFILE_ID,
  organizationId: ORG_ID,
  email: "owner@example.com",
  role: "owner",
  isOwner: true,
  isActive: true,
  permissions: [],
};

type FakeQueryResult = { data: unknown; error: unknown };

/**
 * Minimal fake Supabase client: implements exactly the query-builder
 * surface loadRawBusinessData + ensureServerBusinessBrain use —
 * .from(table).select(...).eq(...).order(...) awaited as { data, error },
 * and .maybeSingle() for the two display-name lookups. `coreError`
 * makes the CORE products query fail, which is the load-failure path.
 */
function fakeSupabase(options: {
  coreError?: string;
  orgName?: string;
  profileName?: string;
}): SupabaseClient {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.order = () => builder;
    builder.maybeSingle = async (): Promise<FakeQueryResult> => {
      if (table === "organizations") {
        return {
          data: options.orgName ? { name: options.orgName } : null,
          error: null,
        };
      }
      if (table === "profiles") {
        return {
          data: options.profileName
            ? { display_name: options.profileName, email: "owner@example.com" }
            : null,
          error: null,
        };
      }
      return { data: null, error: null };
    };
    // Thenable: `await builder` resolves to the list-query result.
    builder.then = (resolve: (value: FakeQueryResult) => void) => {
      if (options.coreError && table === "products") {
        resolve({ data: [], error: new Error(options.coreError) });
      } else {
        resolve({ data: [], error: null });
      }
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

async function main(): Promise<void> {
  console.log("(old path) gateway with no brain returns BRAIN_NOT_INITIALIZED");
  check(
    getBusinessBrain() === null,
    "brain is null at process start (no browser bootstrap on the server)",
  );
  const uninitialized = await getGateway().chat({
    message: "mere business ka kya haal hai",
    channel: "web",
  });
  check(uninitialized.ok === false, "gateway refuses the chat when the brain is absent");
  check(
    (uninitialized.error ?? "").startsWith("BRAIN_NOT_INITIALIZED"),
    "error is BRAIN_NOT_INITIALIZED (the 503 the route maps)",
  );

  console.log("(failure) a failed server-side load fails honestly");
  const failed = await ensureServerBusinessBrain(
    fakeSupabase({ coreError: "products table unavailable" }),
    ownerActor,
  );
  check(failed.ok === false, "init reports failure when a core collection fails to load");
  check(
    failed.ok === false &&
      failed.error.startsWith("BRAIN_NOT_INITIALIZED"),
    "failure error keeps the BRAIN_NOT_INITIALIZED prefix (route maps it to 503)",
  );
  check(
    failed.ok === false && failed.error.includes("Failed to load raw business data"),
    "failure error carries the underlying reason, not a generic message",
  );
  check(
    getBusinessBrain() === null,
    "a failed init creates no half-initialized brain",
  );

  console.log("(fix) server-side init makes the gateway answer");
  const inited = await ensureServerBusinessBrain(
    fakeSupabase({ orgName: "OP TRADERS", profileName: "Umair" }),
    ownerActor,
  );
  check(inited.ok === true, "init succeeds with empty-but-loadable org data");
  check(getBusinessBrain() !== null, "brain singleton exists after server-side init");
  check(
    getGateway().getStatus().ready === true,
    "gateway status reports ready after server-side init",
  );
  const answered = await getGateway().chat({
    message: "mere business ka kya haal hai",
    channel: "web",
  });
  check(
    !(answered.error ?? "").startsWith("BRAIN_NOT_INITIALIZED"),
    "gateway proceeds past the brain check (no BRAIN_NOT_INITIALIZED)",
  );
  check(answered.ok === true, "gateway answers ok once the brain is initialized");
  check(
    typeof answered.message === "string" && answered.message.length > 0,
    "gateway returns a real message (no-provider fallback with no LLM keys)",
  );

  console.log("(wiring) the route initializes the brain before the gateway");
  const routeSource = readFileSync(
    "src/app/api/conversation/chat/route.ts",
    "utf8",
  );
  check(
    routeSource.includes('import { ensureServerBusinessBrain } from "@/lib/conversation/server-brain"'),
    "route imports ensureServerBusinessBrain",
  );
  check(
    routeSource.includes('import { createSupabaseService } from "@/lib/supabase/server"'),
    "route imports createSupabaseService (service-role client, present on Vercel)",
  );
  check(
    routeSource.includes("ensureServerBusinessBrain(supabase, auth.actor)"),
    "route initializes the brain from the authenticated actor",
  );
  check(
    routeSource.indexOf("ensureServerBusinessBrain(supabase, auth.actor)") <
      routeSource.indexOf("getGateway().chat(body, brainInit.brain)"),
    "brain init runs BEFORE getGateway().chat(body)",
  );
  check(
    routeSource.includes("authErrorResponse(brainInit.error, 503)"),
    "init failure returns an honest 503 via the route's error shape",
  );

  console.log("(preserved) existing route behavior is untouched");
  check(
    routeSource.includes("requireAuthenticatedOrg(request)"),
    "auth still goes through requireAuthenticatedOrg first",
  );
  check(
    routeSource.includes('error: "Request body must be a JSON object"'),
    "body-must-be-JSON-object 400 is preserved",
  );
  check(
    routeSource.includes('result.error?.startsWith("BRAIN_NOT_INITIALIZED") ? 503'),
    "gateway 503 mapping for BRAIN_NOT_INITIALIZED is preserved",
  );
  check(
    !routeSource.includes("localStorage") && !routeSource.includes("window."),
    "route init path uses no browser-only APIs",
  );

  console.log("(loader) staff-400 fix: profiles select requests no timestamps");
  const loaderSource = readFileSync("src/lib/brain/supabase-loader.ts", "utf8");
  const profilesSelect = loaderSource.match(/from\("profiles"\)\.select\("([^"]*)"\)/);
  check(profilesSelect !== null, "profiles select exists in the loader");
  check(
    profilesSelect !== null &&
      !profilesSelect[1].includes("created_at") &&
      !profilesSelect[1].includes("updated_at"),
    "profiles select requests neither created_at nor updated_at (PostgREST 400)",
  );
  check(
    !loaderSource.includes("p.created_at") && !loaderSource.includes("p.updated_at"),
    "staff mapping no longer reads the dropped columns",
  );

  console.log(`\nAll ${passed} gateway brain-init checks passed.`);
}

void main();
