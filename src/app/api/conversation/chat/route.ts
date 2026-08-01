import { NextRequest, NextResponse } from "next/server";
import { getGateway } from "@/lib/conversation";
import type { ChatRequest } from "@/lib/conversation";

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, message: "", conversationId: "", requestId: "", version: "1.0", correlationId: "", timestamp: new Date().toISOString(), error: "Request body must be a JSON object" },
        { status: 400 },
      );
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
