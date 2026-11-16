import { NextRequest, NextResponse } from "next/server";
import { getGateway } from "@/lib/conversation";
import { requireAuthenticatedOrg } from "@/lib/identity/authorization";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Auth first (P0-5): the stream spends LLM calls, so it must never
  // answer an unauthenticated request. Any signed-in user with an org
  // (owner or staff) may chat. An auth failure is answered with plain
  // JSON (not SSE) so the client can detect it by status before any
  // event is enqueued.
  const auth = await requireAuthenticatedOrg(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Invalid JSON body" })}\n\n`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      },
    );
  }

  const gateway = getGateway();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of gateway.chatStream(body as any)) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ type: "error", error: "Stream failed" })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
