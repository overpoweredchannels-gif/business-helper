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

    const {
      customer_name,
      shop_name,
      phone,
      whatsapp,
      city,
      area,
      customer_type,
      credit_limit,
      credit_days,
      credit_policy,
      preferred_payment_method,
      allow_over_limit,
      allow_overdue_sales,
    } = body;

    const errors: string[] = [];
    if (!customer_name || !String(customer_name).trim()) errors.push("customer_name is required");
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, error: errors.join("; ") }, { status: 400 });
    }

    const supabase = createSupabaseService();
    const now = new Date().toISOString();

    const insertRes = await supabase
      .from("customers")
      .insert({
        organization_id: organizationId,
        customer_name: String(customer_name).trim(),
        shop_name: shop_name ? String(shop_name).trim() : null,
        phone: phone ? String(phone).trim() : null,
        whatsapp: whatsapp ? String(whatsapp).trim() : null,
        city: city ? String(city).trim() : null,
        area: area ? String(area).trim() : null,
        customer_type: customer_type ? String(customer_type).trim() : "Retail",
        credit_limit: credit_limit === undefined || credit_limit === null || credit_limit === "" ? null : Number(credit_limit),
        credit_days: credit_days === undefined || credit_days === null || credit_days === "" ? null : Number(credit_days),
        credit_policy: credit_policy ? String(credit_policy).trim() : credit_limit === undefined || credit_limit === null || credit_limit === "" ? "cash_only" : "unrestricted",
        preferred_payment_method: preferred_payment_method ? String(preferred_payment_method).trim() : null,
        allow_over_limit: allow_over_limit === undefined ? false : Boolean(allow_over_limit),
        allow_overdue_sales: allow_overdue_sales === undefined ? false : Boolean(allow_overdue_sales),
        created_at: now,
        updated_at: now,
      })
      .select("id, customer_name")
      .single();

    if (insertRes.error) {
      return NextResponse.json(
        { ok: false, error: `Failed to create customer: ${insertRes.error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      customerId: insertRes.data.id,
      customerName: insertRes.data.customer_name,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
