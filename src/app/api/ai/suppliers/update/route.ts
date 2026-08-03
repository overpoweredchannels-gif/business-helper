import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { resolveActor, buildOrganizationContext } from "@/lib/identity/api-context";

export const runtime = "nodejs";

const TEXT_FIELDS = [
  "supplier_name",
  "contact_person",
  "phone",
  "whatsapp",
  "city",
  "area",
  "notes",
  "preferred_payment_method",
] as const;

const NUMERIC_FIELDS = ["credit_limit", "credit_days"] as const;

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
    const now = new Date().toISOString();

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

    const update: Record<string, unknown> = { updated_at: now };

    for (const field of TEXT_FIELDS) {
      if (body[field] !== undefined) {
        update[field] = body[field] === null ? null : String(body[field]).trim();
      }
    }

    for (const field of NUMERIC_FIELDS) {
      if (body[field] !== undefined) {
        const value = body[field];
        update[field] = value === null || value === "" ? null : Number(value);
      }
    }

    if (body.credit_limit !== undefined && body.credit_limit !== null && body.credit_limit !== "") {
      const limit = Number(body.credit_limit);
      if (!Number.isFinite(limit)) {
        return NextResponse.json({ ok: false, error: "credit_limit must be a valid number" }, { status: 400 });
      }
      update.credit_policy = "unrestricted";
    }

    if (body.credit_policy !== undefined) {
      update.credit_policy = body.credit_policy ? String(body.credit_policy).trim() : null;
    }

    if (body.allow_over_limit !== undefined) update.allow_over_limit = Boolean(body.allow_over_limit);
    if (body.allow_overdue_sales !== undefined) update.allow_overdue_sales = Boolean(body.allow_overdue_sales);

    const updateRes = await supabase.from("suppliers").update(update).eq("id", supplier_id).eq("organization_id", organizationId);

    if (updateRes.error) {
      return NextResponse.json(
        { ok: false, error: `Failed to update supplier: ${updateRes.error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, supplierId: supplier_id });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
