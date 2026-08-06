import { NextRequest, NextResponse } from "next/server";
import { createSupabaseUserClient, createSupabaseService } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/identity/authorization";
import { normalizeOptionalText, normalizeOptionalNumber } from "@/lib/sales/validation";
import { logAuditEvent } from "@/lib/identity/audit";
import { Customer } from "@/lib/tradeos/types";

export const runtime = "nodejs";

const getAccessToken = (request: NextRequest): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

const CREDIT_POLICIES = ["cash_only", "limit_only", "days_only", "limit_and_days", "unrestricted"];
const VISIT_FREQUENCIES = ["daily", "weekly", "monthly", "none"];
const PRIORITIES = ["high", "medium", "low"];

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "customers_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const supabase = createSupabaseService();
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, customer_name, shop_name, phone, whatsapp, city, area, customer_type, credit_policy, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, preferred_payment_method, is_active, notes, latitude, longitude, assigned_salesman_id, assigned_territory_id, visit_frequency, priority",
    )
    .eq("organization_id", permission.actor.organizationId)
    .order("customer_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ customers: (data ?? []) as Customer[] });
}

export async function POST(request: NextRequest) {
  try {
    const permission = await requirePermission(request, "customers_manage");
    if (!permission.allowed || !permission.actor) {
      return NextResponse.json(
        { ok: false, error: permission.reason ?? "Forbidden" },
        { status: 403 }
      );
    }

    const organizationId = permission.actor.organizationId;
    const body = await request.json().catch(() => ({}));

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

    const visit_frequency = normalizeOptionalText(body?.visit_frequency) ?? "weekly";
    if (!VISIT_FREQUENCIES.includes(visit_frequency)) {
      return NextResponse.json(
        { ok: false, error: "Visit frequency must be one of: daily, weekly, monthly, none." },
        { status: 400 }
      );
    }
    const priority = normalizeOptionalText(body?.priority) ?? "medium";
    if (!PRIORITIES.includes(priority)) {
      return NextResponse.json(
        { ok: false, error: "Priority must be one of: high, medium, low." },
        { status: 400 }
      );
    }

    const supabase = createSupabaseUserClient(getAccessToken(request));
    const { data, error } = await supabase
      .from("customers")
      .insert({
        organization_id: organizationId,
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
        preferred_payment_method: normalizeOptionalText(body?.preferred_payment_method),
        assigned_salesman_id: body?.assigned_salesman_id ? String(body.assigned_salesman_id) : null,
        assigned_territory_id: body?.assigned_territory_id ? String(body.assigned_territory_id) : null,
        visit_frequency,
        priority,
        latitude: normalizeOptionalNumber(body?.latitude),
        longitude: normalizeOptionalNumber(body?.longitude),
      })
      .select("id, customer_name, is_active")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    logAuditEvent({
      organizationId,
      actorProfileId: permission.actor.profileId,
      actorEmail: permission.actor.email,
      action: "customer_created",
      entityType: "customer",
      entityId: data.id,
      description: `Created customer ${customer_name}`,
      success: true,
    });

    return NextResponse.json({ ok: true, customer: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create customer";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
