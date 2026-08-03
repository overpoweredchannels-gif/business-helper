import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { resolveActor, buildOrganizationContext } from "@/lib/identity/api-context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { actor, error, status } = await resolveActor(req);
    if (error || !actor) {
      return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
    }

    const organizationContext = buildOrganizationContext(actor);
    const organizationId = organizationContext.actor.organizationId;
    const { supplier_id } = body;

    const errors: string[] = [];
    if (!supplier_id) errors.push("supplier_id is required");
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, error: errors.join("; ") }, { status: 400 });
    }

    const supabase = createSupabaseService();

    const existing = await supabase
      .from("suppliers")
      .select("id")
      .eq("id", supplier_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (existing.error) {
      return NextResponse.json({ ok: false, error: existing.error.message }, { status: 500 });
    }
    if (!existing.data) {
      return NextResponse.json({ ok: false, error: "Supplier not found" }, { status: 404 });
    }

    const deleteRes = await supabase
      .from("suppliers")
      .delete()
      .eq("id", supplier_id)
      .eq("organization_id", organizationId);

    if (deleteRes.error) {
      return NextResponse.json(
        { ok: false, error: `Failed to delete supplier: ${deleteRes.error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, supplierId: supplier_id });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
