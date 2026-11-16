import { NextRequest, NextResponse } from "next/server";
import { getGateway } from "@/lib/conversation";
import { requireAuthenticatedOrg } from "@/lib/identity/authorization";

export async function GET(request: NextRequest) {
  // Auth first (P0-5): gateway status is workspace state, not public.
  // Any signed-in user with an org (owner or staff) may read it.
  const auth = await requireAuthenticatedOrg(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const status = getGateway().getStatus();
  return NextResponse.json(status, { status: 200 });
}
