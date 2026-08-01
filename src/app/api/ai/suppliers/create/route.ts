import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      organizationId,
      supplier_name,
      contact_person,
      phone,
      whatsapp,
      city,
      area,
      notes,
      credit_limit,
      credit_days,
      credit_policy,
      preferred_payment_method,
      allow_over_limit,
      allow_overdue_sales,
    } = body;

    const errors: string[] = [];
    if (!organizationId) errors.push("organizationId is required");
    if (!supplier_name || !String(supplier_name).trim()) errors.push("supplier_name is required");
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, error: errors.join("; ") }, { status: 400 });
    }

    const supabase = createSupabaseService();
    const now = new Date().toISOString();

    const insertRes = await supabase
      .from("suppliers")
      .insert({
        organization_id: organizationId,
        supplier_name: String(supplier_name).trim(),
        contact_person: contact_person ? String(contact_person).trim() : null,
        phone: phone ? String(phone).trim() : null,
        whatsapp: whatsapp ? String(whatsapp).trim() : null,
        city: city ? String(city).trim() : null,
        area: area ? String(area).trim() : null,
        notes: notes ? String(notes).trim() : null,
        credit_limit: credit_limit === undefined || credit_limit === null || credit_limit === "" ? null : Number(credit_limit),
        credit_days: credit_days === undefined || credit_days === null || credit_days === "" ? null : Number(credit_days),
        credit_policy: credit_policy ? String(credit_policy).trim() : credit_limit === undefined || credit_limit === null || credit_limit === "" ? "cash_only" : "unrestricted",
        preferred_payment_method: preferred_payment_method ? String(preferred_payment_method).trim() : null,
        allow_over_limit: allow_over_limit === undefined ? false : Boolean(allow_over_limit),
        allow_overdue_sales: allow_overdue_sales === undefined ? false : Boolean(allow_overdue_sales),
        created_at: now,
        updated_at: now,
      })
      .select("id, supplier_name")
      .single();

    if (insertRes.error) {
      return NextResponse.json(
        { ok: false, error: `Failed to create supplier: ${insertRes.error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      supplierId: insertRes.data.id,
      supplierName: insertRes.data.supplier_name,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
