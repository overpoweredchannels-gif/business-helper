import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "sales_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  const supabase = createSupabaseService();
  const { data, error } = await supabase
    .from("collections")
    .select(`
      id, employee_id, customer_id, visit_id, amount, method, reference_number,
      cheque_date, cheque_bank, bank_transfer_ref, status, approved_by, approved_at,
      notes, images, created_at,
      customers!inner(customer_name, shop_name),
      employees!inner(full_name)
    `)
    .eq("organization_id", permission.actor.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, collections: data ?? [] });
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
    amount?: number;
    method?: string;
    referenceNumber?: string;
    chequeDate?: string;
    chequeBank?: string;
    bankTransferRef?: string;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.customerId || typeof body.amount !== "number" || body.amount <= 0 || !body.method) {
    return NextResponse.json({ ok: false, error: "customerId, amount, method are required" }, { status: 400 });
  }
  if (!["cash", "cheque", "bank_transfer"].includes(body.method)) {
    return NextResponse.json({ ok: false, error: "method must be cash, cheque, or bank_transfer" }, { status: 400 });
  }

  // Resolve employee id for the actor if not provided
  let employeeId = body.employeeId;
  const supabase = createSupabaseService();
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

  // Verify customer belongs to org
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("id", body.customerId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ ok: false, error: "Customer not found" }, { status: 400 });
  }

  const { data: collection, error } = await supabase
    .from("collections")
    .insert({
      organization_id: permission.actor.organizationId,
      employee_id: employeeId,
      customer_id: body.customerId,
      visit_id: body.visitId ?? null,
      amount: body.amount,
      method: body.method,
      reference_number: body.referenceNumber ?? null,
      cheque_date: body.chequeDate ?? null,
      cheque_bank: body.chequeBank ?? null,
      bank_transfer_ref: body.bankTransferRef ?? null,
      status: "pending",
      notes: body.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: `Failed to record collection: ${error.message}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true, collection: collection ?? null });
}