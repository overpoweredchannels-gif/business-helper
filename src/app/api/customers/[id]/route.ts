import { NextRequest, NextResponse } from "next/server";
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/identity/authorization";
import { normalizeOptionalText, normalizeOptionalNumber } from "@/lib/sales/validation";

export const runtime = "nodejs";

const getAccessToken = (request: NextRequest): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

const CREDIT_POLICIES = ["cash_only", "limit_only", "days_only", "limit_and_days", "unrestricted"];

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requirePermission(request, "customers_manage");
    if (!permission.allowed || !permission.actor) {
      return NextResponse.json(
        { ok: false, error: permission.reason ?? "Forbidden" },
        { status: 403 }
      );
    }

    const organizationId = permission.actor.organizationId;
    const { id } = await params;
    const body = await request.json();

    const customer_name = normalizeOptionalText(body?.customer_name);
    if (!customer_name) {
      return NextResponse.json({ ok: false, error: "Customer name is required." }, { status: 400 });
    }
    if (customer_name.length > 150) {
      return NextResponse.json(
        { ok: false, error: "Customer name must be 150 characters or fewer." },
        { status: 400 }
      );
    }

    const credit_limit = normalizeOptionalNumber(body?.credit_limit);
    if (credit_limit !== null && credit_limit < 0) {
      return NextResponse.json({ ok: false, error: "Credit limit cannot be negative." }, { status: 400 });
    }

    const credit_days = normalizeOptionalNumber(body?.credit_days);
    if (credit_days !== null && credit_days < 0) {
      return NextResponse.json({ ok: false, error: "Credit days cannot be negative." }, { status: 400 });
    }

    const credit_policy = normalizeOptionalText(body?.credit_policy);
    if (credit_policy && !CREDIT_POLICIES.includes(credit_policy)) {
      return NextResponse.json(
        { ok: false, error: "Credit policy must be one of: cash_only, limit_only, days_only, limit_and_days, unrestricted." },
        { status: 400 }
      );
    }

    const VISIT_FREQUENCIES = ["daily", "weekly", "monthly", "none"];
    const PRIORITIES = ["high", "medium", "low"];

    const visit_frequency = normalizeOptionalText(body?.visit_frequency);
    if (visit_frequency && !VISIT_FREQUENCIES.includes(visit_frequency)) {
      return NextResponse.json(
        { ok: false, error: "Visit frequency must be one of: daily, weekly, monthly, none." },
        { status: 400 }
      );
    }
    const priority = normalizeOptionalText(body?.priority);
    if (priority && !PRIORITIES.includes(priority)) {
      return NextResponse.json(
        { ok: false, error: "Priority must be one of: high, medium, low." },
        { status: 400 }
      );
    }

    const latitude = normalizeOptionalNumber(body?.latitude);
    const longitude = normalizeOptionalNumber(body?.longitude);

    const updates: Record<string, unknown> = {
      customer_name,
      shop_name: normalizeOptionalText(body?.shop_name),
      phone: normalizeOptionalText(body?.phone),
      whatsapp: normalizeOptionalText(body?.whatsapp),
      city: normalizeOptionalText(body?.city),
      area: normalizeOptionalText(body?.area),
      customer_type: normalizeOptionalText(body?.customer_type) ?? "Retailer",
      notes: normalizeOptionalText(body?.notes),
      credit_limit,
      credit_days,
      credit_policy: credit_policy ?? "cash_only",
      allow_over_limit: body?.allow_over_limit === true,
      allow_overdue_sales: body?.allow_overdue_sales === true,
      updated_at: new Date().toISOString(),
    };
    if (body?.preferred_payment_method !== undefined) {
      updates.preferred_payment_method = normalizeOptionalText(body.preferred_payment_method);
    }

    // Field-sales assignment columns
    updates.assigned_salesman_id = body?.assigned_salesman_id ? String(body.assigned_salesman_id) : null;
    updates.assigned_territory_id = body?.assigned_territory_id ? String(body.assigned_territory_id) : null;
    updates.visit_frequency = visit_frequency ?? "weekly";
    updates.priority = priority ?? "medium";
    updates.latitude = latitude;
    updates.longitude = longitude;

    const supabase = createSupabaseUserClient(getAccessToken(request));
    const { data, error } = await supabase
      .from("customers")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("id, customer_name, is_active")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, customer: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update customer";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requirePermission(request, "customers_manage");
    if (!permission.allowed || !permission.actor) {
      return NextResponse.json(
        { ok: false, error: permission.reason ?? "Forbidden" },
        { status: 403 }
      );
    }

    const organizationId = permission.actor.organizationId;
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const restore = body?.action === "restore";

    const supabase = createSupabaseUserClient(getAccessToken(request));
    const { data, error } = await supabase
      .from("customers")
      .update({ is_active: restore, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("id, customer_name, is_active")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, customer: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive customer";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
