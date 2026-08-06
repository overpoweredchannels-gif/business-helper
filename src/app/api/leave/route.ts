import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor || !permission.actor.profileId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") ?? "mine";
  const status = searchParams.get("status") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  const supabase = createSupabaseService();

  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("profile_id", permission.actor.profileId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();

  const canSeeAll =
    permission.actor.role === "owner" || permission.actor.role === "admin" || permission.actor.role === "supervisor";

  let query = supabase
    .from("leave_requests")
    .select("*, employee:employees(id, full_name, designation)")
    .eq("organization_id", permission.actor.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scope === "mine" || !canSeeAll) {
    if (!emp) return NextResponse.json({ ok: true, requests: [] });
    query = query.eq("employee_id", emp.id);
  }

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, requests: data ?? [] });
}

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor || !permission.actor.profileId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const leaveType = (body.leave_type as string) ?? "annual";
  const startDate = (body.start_date as string) ?? "";
  const endDate = (body.end_date as string) ?? startDate;
  const reason = (body.reason as string) ?? null;

  if (!startDate) {
    return NextResponse.json({ ok: false, error: "start_date is required" }, { status: 400 });
  }
  if (new Date(endDate) < new Date(startDate)) {
    return NextResponse.json({ ok: false, error: "end_date cannot be before start_date" }, { status: 400 });
  }

  const supabase = createSupabaseService();
  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("profile_id", permission.actor.profileId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();
  if (!emp) {
    return NextResponse.json({ ok: false, error: "No employee record linked to this profile" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("leave_requests")
    .insert({
      organization_id: permission.actor.organizationId,
      employee_id: emp.id,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, request: data });
}

export async function PATCH(request: NextRequest) {
  const permission = await requirePermission(request, "draft_approval");
  if (!permission.allowed || !permission.actor || !permission.actor.profileId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const canManage =
    permission.actor.role === "owner" || permission.actor.role === "admin" || permission.actor.role === "supervisor";
  if (!canManage) {
    return NextResponse.json({ ok: false, error: "Only owners, admins, and supervisors can review leave requests" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const status = (body.status as string) ?? "";
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ ok: false, error: "status must be approved or rejected" }, { status: 400 });
  }

  const supabase = createSupabaseService();

  const { data: submittedBy } = await supabase
    .from("employees")
    .select("id")
    .eq("profile_id", permission.actor.profileId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("leave_requests")
    .update({
      status,
      reviewed_by: submittedBy?.id ?? null,
      reviewed_at: new Date().toISOString(),
      review_note: (body.review_note as string) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", permission.actor.organizationId)
    .select("*, employee:employees(id, full_name)")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, request: data });
}