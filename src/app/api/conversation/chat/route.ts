import { NextRequest, NextResponse } from "next/server";
import { getGateway } from "@/lib/conversation";
import type { ChatRequest } from "@/lib/conversation";
import { ensureServerBusinessBrain } from "@/lib/conversation/server-brain";
import { requireAuthenticatedOrg } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

function authErrorResponse(error: string, status: number) {
  return NextResponse.json(
    { ok: false, message: "", conversationId: "", requestId: "", version: "1.0", correlationId: "", timestamp: new Date().toISOString(), error },
    { status },
  );
}

export async function POST(request: NextRequest) {
  try {
    // Auth first (P0-5): the gateway can spend LLM calls and drive
    // actions, so it must never answer an unauthenticated request. Any
    // signed-in user with an org (owner or staff) may chat; the
    // conversation client sends its session token as a Bearer header.
    const auth = await requireAuthenticatedOrg(request);
    if (!auth.ok) {
      return authErrorResponse(auth.error, auth.status);
    }

    const body: ChatRequest = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, message: "", conversationId: "", requestId: "", version: "1.0", correlationId: "", timestamp: new Date().toISOString(), error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    // Server-side Business Brain init (gateway brain fix, 2026-11-19):
    // the brain is an in-memory singleton that only exists in the process
    // that called initializeBusinessBrain. The browser bootstraps it on
    // page load, but this route runs on the server, so without an init
    // here getBusinessBrain() is always null and the gateway answers
    // every request with BRAIN_NOT_INITIALIZED (503). Load the org's raw
    // business data and initialize the brain for this request, the same
    // way the sibling AI routes load data server-side. A failed load
    // fails honestly with the same 503 code — never a fake answer.
    const supabase = createSupabaseService();
    const brainInit = await ensureServerBusinessBrain(supabase, auth.actor);
    if (!brainInit.ok) {
      return authErrorResponse(brainInit.error, 503);
    }

    const result = await getGateway().chat(body);
    const httpStatus = result.ok ? 200 : result.error?.startsWith("VALIDATION_ERROR") ? 422 : result.error?.startsWith("BRAIN_NOT_INITIALIZED") ? 503 : 400;

    return NextResponse.json(result, { status: httpStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { ok: false, message: "", conversationId: "", requestId: "", version: "1.0", correlationId: "", timestamp: new Date().toISOString(), error: message },
      { status: 500 },
    );
  }
}
