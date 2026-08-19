import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "sales_view");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  try {
    const supabase = createSupabaseService();
    const { data: org } = await supabase
      .from("organizations")
      .select("name, address, city, phone")
      .eq("id", permission.actor.organizationId)
      .maybeSingle();

    return NextResponse.json({ ok: true, branding: org ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load organization branding";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}