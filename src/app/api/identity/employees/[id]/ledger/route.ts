import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { buildSalesmanWorkspace } from "@/lib/sales/salesman-workspace-service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const permission = await requirePermission(request, "administration");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createSupabaseService();
  const orgId = permission.actor.organizationId;

  // Get employee profile
  const { data: employee, error: empError } = await supabase
    .from("employees")
    .select("id, profile_id, full_name, designation, employee_id, phone, status, assigned_route_id, assigned_territory_id, assigned_supervisor_id, department, joining_date, photo_url")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (empError || !employee) {
    return NextResponse.json({ ok: false, error: "Employee not found" }, { status: 404 });
  }

  const workspace = await buildSalesmanWorkspace({ organizationId: orgId, employeeId: id });

  // Run parallel aggregation queries
  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().split("T")[0];
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const [
    salesRes,
    visitsRes,
    collectionsRes,
    attendanceRes,
    targetsRes,
    feedbackRes,
  ] = await Promise.all([
    Promise.resolve({ data: workspace?.sales.recent ?? [], error: null }),

    // Visits
    supabase
      .from("customer_visits")
      .select("id, visit_status, created_at")
      .eq("organization_id", orgId)
      .eq("employee_id", id),

    // Collections
    supabase
      .from("collections")
      .select("id, amount, status, created_at")
      .eq("organization_id", orgId)
      .eq("employee_id", id),

    // Attendance
    supabase
      .from("attendance_records")
      .select("id, status, duty_start, duty_end, total_hours, date")
      .eq("organization_id", orgId)
      .eq("employee_id", id)
      .gte("date", monthStartStr),

    // Targets
    supabase
      .from("sales_targets")
      .select("id, period, metric, target_value, start_date, end_date")
      .eq("organization_id", orgId)
      .eq("employee_id", id),

    // Feedback
    supabase
      .from("customer_feedback")
      .select("id, type, status, created_at")
      .eq("organization_id", orgId)
      .eq("employee_id", id),
  ]);

  const aggregationError =
    visitsRes.error ??
    collectionsRes.error ??
    attendanceRes.error ??
    targetsRes.error ??
    feedbackRes.error;

  if (aggregationError) {
    console.error("Employee ledger aggregation failed", {
      employeeId: id,
      organizationId: orgId,
      error: aggregationError.message,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to load employee activity." },
      { status: 500 }
    );
  }

  // Process sales
  const sales = salesRes.data ?? [];
  const salesTotal = sales.reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0);
  const salesToday = sales
    .filter((s) => s.created_at?.startsWith(today))
    .reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0);
  const salesThisWeek = sales
    .filter((s) => s.created_at?.startsWith(weekStartStr))
    .reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0);
  const salesThisMonth = sales
    .filter((s) => s.created_at?.startsWith(monthStartStr))
    .reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0);

  // Process visits
  const visits = visitsRes.data ?? [];
  const visitsTotal = visits.length;
  const visitsCompleted = visits.filter((v) => v.visit_status === "completed").length;
  const visitsMissed = visits.filter((v) => v.visit_status === "missed").length;
  const visitsPending = visits.filter(
    (v) => v.visit_status === "planned" || v.visit_status === "in_progress"
  ).length;
  const visitsToday = visits.filter((v) => v.created_at?.startsWith(today)).length;

  // Process collections
  const collections = collectionsRes.data ?? [];
  const collectionsTotal = collections.length;
  const collectionsApproved = collections.filter((c) => c.status === "approved").length;
  const collectionsPending = collections.filter((c) => c.status === "pending").length;
  const collectionsAmount = collections
    .filter((c) => c.status === "approved")
    .reduce((sum, c) => sum + Number(c.amount ?? 0), 0);

  // Process attendance
  const attendance = attendanceRes.data ?? [];
  const attendanceDays = attendance.length;
  const attendancePresent = attendance.filter((a) => a.status === "present").length;
  const attendanceLate = attendance.filter((a) => a.status === "late").length;
  const attendanceAbsent = attendance.filter((a) => a.status === "absent").length;
  const attendanceLeave = attendance.filter((a) => a.status === "leave").length;
  const totalHours = attendance.reduce((sum, a) => sum + Number(a.total_hours ?? 0), 0);

  // Process targets
  const targets = targetsRes.data ?? [];

  // Process feedback
  const feedback = feedbackRes.data ?? [];
  const feedbackOpen = feedback.filter((f) => f.status === "open" || f.status === "in_progress").length;
  const feedbackResolved = feedback.filter((f) => f.status === "resolved" || f.status === "closed").length;

  // Recent activity
  const recentSales = sales
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);
  const recentVisits = visits
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);
  const recentCollections = collections
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return NextResponse.json({
    ok: true,
    employee,
    aggregates: {
      sales: {
        total: workspace?.sales.total ?? salesTotal,
        today: workspace?.sales.today ?? salesToday,
        thisWeek: workspace?.sales.thisWeek ?? salesThisWeek,
        thisMonth: workspace?.sales.thisMonth ?? salesThisMonth,
        count: workspace?.sales.count ?? sales.length,
      },
      visits: {
        total: visitsTotal,
        completed: visitsCompleted,
        missed: visitsMissed,
        pending: visitsPending,
        today: visitsToday,
      },
      collections: {
        total: collectionsTotal,
        approved: collectionsApproved,
        pending: collectionsPending,
        amount: collectionsAmount,
      },
      attendance: {
        days: attendanceDays,
        present: attendancePresent,
        late: attendanceLate,
        absent: attendanceAbsent,
        leave: attendanceLeave,
        totalHours,
      },
      targets: targets,
      feedback: {
        total: feedback.length,
        open: feedbackOpen,
        resolved: feedbackResolved,
      },
    },
    recent: {
      sales: workspace?.sales.recent ?? recentSales,
      visits: recentVisits,
      collections: recentCollections,
    },
    assignment: {
      territory: workspace?.territory ?? null,
      route: workspace?.route ?? null,
      stops: workspace?.stops ?? [],
      customers: workspace?.customers ?? [],
    },
    analytics: {
      byDate: workspace?.sales.byDate ?? [],
      byProduct: workspace?.sales.byProduct ?? [],
      byCustomer: workspace?.sales.byCustomer ?? [],
    },
  });
}
