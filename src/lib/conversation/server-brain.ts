// Server-side Business Brain init for the conversation gateway route.
//
// Defect (live QA 2026-11-19): POST /api/conversation/chat returned 503
// BRAIN_NOT_INITIALIZED on every request. The brain is an in-memory
// singleton that only exists in the process that called
// initializeBusinessBrain. The browser bootstraps it on page load
// (page.tsx -> bootstrapOrganizationData), but this route runs on the
// server, so getBusinessBrain() was always null there and the gateway
// answered every request with BRAIN_NOT_INITIALIZED — while the in-app
// chat looked fine because it never uses this route (it POSTs to
// /api/business-brain with browser-loaded context instead).
//
// Fix: the route loads the org's raw business data server-side and
// initializes the brain for the request before calling the gateway — the
// same loadRawBusinessData pattern the sibling AI routes
// (business-intelligence, executive, financial) already use.
//
// Display names are best-effort: a missing organizations row or profile
// row must never fail the chat — the brain works with empty names (only
// the "Owner: ..." context line and the snapshot name are affected).
import type { SupabaseClient } from "@supabase/supabase-js";
import { bootstrapOrganizationData } from "@/lib/brain/supabase-loader";
import type { ActorContext } from "@/lib/identity/types";

export type ServerBrainInitResult = { ok: true } | { ok: false; error: string };

async function bestEffortString(
  query: () => PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>,
  field: string,
): Promise<string> {
  try {
    const { data, error } = await query();
    if (error || !data) return "";
    const value = data[field];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export async function ensureServerBusinessBrain(
  supabase: SupabaseClient,
  actor: ActorContext,
): Promise<ServerBrainInitResult> {
  const organizationName = await bestEffortString(
    () =>
      supabase
        .from("organizations")
        .select("name")
        .eq("id", actor.organizationId)
        .maybeSingle(),
    "name",
  );
  const profileName = await bestEffortString(
    () =>
      supabase
        .from("profiles")
        .select("display_name, email")
        .eq("id", actor.profileId)
        .maybeSingle(),
    "display_name",
  );
  const ownerName = profileName || actor.email || "";

  const result = await bootstrapOrganizationData(
    supabase,
    actor.organizationId,
    organizationName,
    ownerName,
  );
  if (!result.success) {
    return {
      ok: false,
      error: `BRAIN_NOT_INITIALIZED: Business Brain is not initialized. Load business data first.${result.error ? ` (${result.error})` : ""}`,
    };
  }
  return { ok: true };
}
