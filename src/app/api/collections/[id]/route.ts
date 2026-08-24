import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requirePermission(request, "draft_approval");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let body: { action?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ ok: false, error: "action must be approve or reject" }, { status: 400 });
  }

  const supabase = createSupabaseService();

  const { data: existing } = await supabase
    .from("collections")
    .select("id, organization_id, status, employee_id, amount, customer_id, method, reference_number, notes")
    .eq("id", id)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ ok: false, error: "Collection not found" }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json({ ok: false, error: `Collection is already ${existing.status}` }, { status: 400 });
  }

  const now = new Date().toISOString();

  const nextStatus = body.action === "approve" ? "approved" : "rejected";
  const { data: updated, error } = await supabase
    .from("collections")
    .update({
      status: nextStatus,
      approved_by: permission.actor.profileId,
      approved_at: now,
      notes: body.notes ?? existing.notes ?? null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("organization_id", permission.actor.organizationId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (error || !updated) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Collection was already processed by another approver" }, { status: 409 });
  }

  if (body.action === "approve") {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("outstanding_balance")
      .eq("id", existing.customer_id)
      .eq("organization_id", permission.actor.organizationId)
      .maybeSingle();
    if (customerError || !customer) {
      await supabase.from("collections").update({ status: "pending", approved_by: null, approved_at: null }).eq("id", id).eq("organization_id", permission.actor.organizationId).eq("status", "approved");
      return NextResponse.json({ ok: false, error: `Failed to load customer: ${customerError?.message ?? "Customer not found"}` }, { status: 400 });
    }
    const currentBalance = Number(customer?.outstanding_balance ?? 0);
    const paymentMethod = existing.method === "bank_transfer" ? "bank" : existing.method === "cash" ? "cash" : "other";
    const { data: payment, error: paymentError } = await supabase.from("customer_payments").insert({
      organization_id: permission.actor.organizationId,
      customer_id: existing.customer_id,
      amount: Number(existing.amount),
      payment_date: now.split("T")[0],
      payment_method: paymentMethod,
      notes: `Approved collection ${id}${existing.reference_number ? ` (${existing.reference_number})` : ""}`,
    }).select("id").single();
    if (paymentError || !payment) {
      await supabase.from("collections").update({ status: "pending", approved_by: null, approved_at: null }).eq("id", id).eq("organization_id", permission.actor.organizationId).eq("status", "approved");
      return NextResponse.json({ ok: false, error: `Failed to create customer payment: ${paymentError?.message ?? "No payment id returned"}` }, { status: 400 });
    }
    const [{ data: invoices, error: invoicesError }, { data: allocations, error: allocationsError }] = await Promise.all([
      supabase.from("sales_transactions").select("id, total_amount, sale_date, created_at").eq("organization_id", permission.actor.organizationId).eq("customer_id", existing.customer_id).eq("payment_type", "credit").neq("status", "cancelled").neq("status", "void").order("sale_date", { ascending: true }),
      supabase.from("customer_payment_allocations").select("sales_transaction_id, amount").eq("organization_id", permission.actor.organizationId),
    ]);
    if (invoicesError || allocationsError) {
      await supabase.from("customer_payments").delete().eq("id", payment.id).eq("organization_id", permission.actor.organizationId);
      await supabase.from("collections").update({ status: "pending", approved_by: null, approved_at: null }).eq("id", id).eq("organization_id", permission.actor.organizationId).eq("status", "approved");
      return NextResponse.json({ ok: false, error: invoicesError?.message ?? allocationsError?.message }, { status: 500 });
    }
    const allocatedByInvoice = new Map<string, number>();
    for (const allocation of allocations ?? []) allocatedByInvoice.set(String(allocation.sales_transaction_id), (allocatedByInvoice.get(String(allocation.sales_transaction_id)) ?? 0) + Number(allocation.amount ?? 0));
    let remaining = Number(existing.amount);
    const rows: Array<{ organization_id: string; customer_payment_id: string; sales_transaction_id: string; amount: number }> = [];
    for (const invoice of invoices ?? []) {
      const due = Math.max(0, Number(invoice.total_amount ?? 0) - (allocatedByInvoice.get(String(invoice.id)) ?? 0));
      const amount = Math.min(due, remaining);
      if (amount > 0) rows.push({ organization_id: permission.actor.organizationId, customer_payment_id: payment.id, sales_transaction_id: invoice.id, amount });
      remaining -= amount;
      if (remaining <= 0) break;
    }
    if (rows.length) {
      const { error: allocationError } = await supabase.from("customer_payment_allocations").insert(rows);
      if (allocationError) {
        await supabase.from("customer_payments").delete().eq("id", payment.id).eq("organization_id", permission.actor.organizationId);
        await supabase.from("collections").update({ status: "pending", approved_by: null, approved_at: null }).eq("id", id).eq("organization_id", permission.actor.organizationId).eq("status", "approved");
        return NextResponse.json({ ok: false, error: `Failed to allocate customer payment: ${allocationError.message}` }, { status: 400 });
      }
    }
    const { error: balanceError } = await supabase
      .from("customers")
      .update({ outstanding_balance: Math.max(0, currentBalance - Number(existing.amount)) })
      .eq("id", existing.customer_id)
      .eq("organization_id", permission.actor.organizationId);
    if (balanceError) {
      await supabase.from("customer_payment_allocations").delete().eq("customer_payment_id", payment.id).eq("organization_id", permission.actor.organizationId);
      await supabase.from("customer_payments").delete().eq("id", payment.id).eq("organization_id", permission.actor.organizationId);
      await supabase.from("collections").update({ status: "pending", approved_by: null, approved_at: null }).eq("id", id).eq("organization_id", permission.actor.organizationId).eq("status", "approved");
      return NextResponse.json({ ok: false, error: `Failed to update customer balance: ${balanceError.message}` }, { status: 400 });
    }
  }

  // Notify the employee who recorded it
  const { data: employee } = await supabase
    .from("employees")
    .select("profile_id")
    .eq("id", existing.employee_id)
    .maybeSingle();

  if (employee?.profile_id) {
    await supabase.from("notifications").insert({
      organization_id: permission.actor.organizationId,
      recipient_profile_id: employee.profile_id,
      category: "collection",
      title: body.action === "approve" ? "Collection approved" : "Collection rejected",
      body: `${existing.amount} collection ${body.action === "approve" ? "approved" : "rejected"}.`,
      entity_type: "collection",
      entity_id: id,
      channel: "in_app",
      is_read: false,
    });
  }

  await logAuditEvent({
    organizationId: permission.actor.organizationId,
    actorProfileId: permission.actor.profileId,
    actorEmail: permission.actor.email,
    action: body.action === "approve" ? "collection_approved" : "collection_rejected",
    entityType: "collection",
    entityId: id,
    description: `Collection ${existing.amount} ${body.action}`,
    success: true,
  });

  return NextResponse.json({ ok: true, collection: updated });
}
