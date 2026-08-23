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

    const customer_name = body?.customer_name !== undefined ? normalizeOptionalText(body.customer_name) : null;
    if (body?.customer_name !== undefined && !customer_name) {
      return NextResponse.json({ ok: false, error: "Customer name is required." }, { status: 400 });
    }
    if (customer_name && customer_name.length > 150) {
      return NextResponse.json(
        { ok: false, error: "Customer name must be 150 characters or fewer." },
        { status: 400 }
      );
    }

    const credit_limit = body?.credit_limit !== undefined ? normalizeOptionalNumber(body.credit_limit) : null;
    if (body?.credit_limit !== undefined && credit_limit !== null && credit_limit < 0) {
      return NextResponse.json({ ok: false, error: "Credit limit cannot be negative." }, { status: 400 });
    }

    const credit_days = body?.credit_days !== undefined ? normalizeOptionalNumber(body.credit_days) : null;
    if (body?.credit_days !== undefined && credit_days !== null && credit_days < 0) {
      return NextResponse.json({ ok: false, error: "Credit days cannot be negative." }, { status: 400 });
    }

    const credit_policy = body?.credit_policy !== undefined ? normalizeOptionalText(body.credit_policy) : null;
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

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const optionalTextFields = [
      "shop_name", "organization_name", "contact_person", "phone", "whatsapp",
      "city", "area", "address", "shipping_address", "customer_type", "notes",
    ] as const;
    if (customer_name) updates.customer_name = customer_name;
    for (const field of optionalTextFields) {
      if (body?.[field] !== undefined) updates[field] = normalizeOptionalText(body[field]);
    }
    if (body?.credit_limit !== undefined) updates.credit_limit = credit_limit;
    if (body?.credit_days !== undefined) updates.credit_days = credit_days;
    if (body?.credit_policy !== undefined) updates.credit_policy = credit_policy ?? "cash_only";
    if (body?.allow_over_limit !== undefined) updates.allow_over_limit = body.allow_over_limit === true;
    if (body?.allow_overdue_sales !== undefined) updates.allow_overdue_sales = body.allow_overdue_sales === true;
    if (body?.preferred_payment_method !== undefined) {
      updates.preferred_payment_method = normalizeOptionalText(body.preferred_payment_method);
    }

    // Field-sales assignment columns — only touch them when the caller
    // explicitly provides a value, so unrelated customer edits (name, phone,
    // credit policy...) never wipe the assigned salesman / territory.
    if (body?.assigned_salesman_id !== undefined) {
      updates.assigned_salesman_id = body?.assigned_salesman_id ? String(body.assigned_salesman_id) : null;
    }
    if (body?.assigned_territory_id !== undefined) {
      updates.assigned_territory_id = body?.assigned_territory_id ? String(body.assigned_territory_id) : null;
    }
    if (visit_frequency !== null) {
      updates.visit_frequency = visit_frequency;
    }
    if (priority !== null) {
      updates.priority = priority;
    }
    if (latitude !== null) {
      updates.latitude = latitude;
    }
    if (longitude !== null) {
      updates.longitude = longitude;
    }

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
