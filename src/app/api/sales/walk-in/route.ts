import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSalesTool } from "@/lib/sales/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const permission = await requireSalesTool(request, "invoice");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  // A stable, organization-specific UUID prevents two tills creating duplicates.
  const organizationId = permission.actor.organizationId;
  const hash = createHash("sha256").update(`tradeos:walk-in:${organizationId}`).digest("hex");
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  try {
    const db = createSupabaseService();
    const existing = await db.from("customers").select("*").eq("id", id).eq("organization_id", organizationId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (existing.data.is_active === false) return NextResponse.json({ ok: false, error: "The Walk-in customer is inactive. Ask the owner to reactivate it." }, { status: 400 });
      return NextResponse.json({ ok: true, customer: existing.data });
    }
    const created = await db.from("customers").upsert({ id, organization_id: organizationId, customer_name: "Walk-in customer", customer_type: "Retailer", credit_policy: "cash_only", is_active: true, visit_frequency: "none", priority: "medium" }, { onConflict: "id", ignoreDuplicates: true });
    if (created.error) throw created.error;
    const result = await db.from("customers").select("*").eq("id", id).eq("organization_id", organizationId).single();
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, customer: result.data });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not prepare the Walk-in customer. Retry or select an existing customer." }, { status: 500 });
  }
}
