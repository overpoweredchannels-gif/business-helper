import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "customers_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 200);

  const supabase = createSupabaseService();
  let query = supabase
    .from("customer_feedback")
    .select(`
      id, employee_id, customer_id, visit_id, type, title, description, priority, status,
      follow_up_date, images, created_at,
      customers!inner(customer_name, shop_name),
      employees!inner(full_name)
    `)
    .eq("organization_id", permission.actor.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, feedback: data ?? [] });
}

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor || !permission.actor.profileId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  let body: {
    employeeId?: string;
    customerId?: string;
    visitId?: string;
    type?: string;
    title?: string;
    description?: string;
    priority?: string;
    followUpDate?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.customerId || !body.type || !body.description?.trim()) {
    return NextResponse.json({ ok: false, error: "customerId, type, description are required" }, { status: 400 });
  }
  if (!["complaint", "feedback", "note", "request"].includes(body.type)) {
    return NextResponse.json({ ok: false, error: "type must be complaint, feedback, note, or request" }, { status: 400 });
  }

  const supabase = createSupabaseService();

  // Resolve employee id for the actor
  let employeeId = body.employeeId;
  if (!employeeId && permission.actor.profileId) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("profile_id", permission.actor.profileId)
      .eq("organization_id", permission.actor.organizationId)
      .maybeSingle();
    if (emp) employeeId = emp.id;
  }
  if (!employeeId) {
    return NextResponse.json({ ok: false, error: "No employee record linked to this profile" }, { status: 400 });
  }

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("id", body.customerId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ ok: false, error: "Customer not found" }, { status: 400 });
  }

  const { data: feedback, error } = await supabase
    .from("customer_feedback")
    .insert({
      organization_id: permission.actor.organizationId,
      employee_id: employeeId,
      customer_id: body.customerId,
      visit_id: body.visitId ?? null,
      type: body.type,
      title: body.title ?? null,
      description: body.description.trim(),
      priority: body.priority ?? "medium",
      status: "open",
      follow_up_date: body.followUpDate ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: `Failed to record feedback: ${error.message}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true, feedback });
}