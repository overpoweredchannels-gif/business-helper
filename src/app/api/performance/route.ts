import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "monthly";
  let employeeId = searchParams.get("employeeId");

  const permission = await requirePermission(request, "location_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const supabase = createSupabaseService();
  const canViewTeam = permission.actor.isOwner || permission.actor.role === "manager" || permission.actor.role === "supervisor" || Boolean(permission.actor.permissions?.includes("settings_manage"));
  if (!canViewTeam) {
    const { data: ownEmployee } = await supabase.from("employees").select("id").eq("organization_id", permission.actor.organizationId).eq("profile_id", permission.actor.profileId).maybeSingle();
    if (!ownEmployee) return NextResponse.json({ ok: false, error: "No employee record linked to this profile" }, { status: 400 });
    if (employeeId && employeeId !== ownEmployee.id) return NextResponse.json({ ok: false, error: "You can only view your own performance" }, { status: 403 });
    employeeId = ownEmployee.id;
  }
  let response: any;

  if (employeeId) {
    // Salesman personal performance view
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id, profile_id")
      .eq("organization_id", permission.actor.organizationId)
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeError) {
      return NextResponse.json({ ok: false, error: employeeError.message }, { status: 500 });
    }
    if (!employee) {
      return NextResponse.json({ ok: false, error: "Employee not found" }, { status: 404 });
    }

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
    ] = await Promise.all([
      supabase
        .from("sales_transactions")
        .select("id, total_amount, status, sale_date, created_at")
        .eq("organization_id", permission.actor.organizationId)
        .eq("created_by_profile_id", employee.profile_id)
        .neq("status", "cancelled")
        .neq("status", "void"),

      supabase
        .from("customer_visits")
        .select("id, visit_status, created_at")
        .eq("organization_id", permission.actor.organizationId)
        .eq("employee_id", employeeId),

      supabase
        .from("collections")
        .select("id, amount, status, created_at")
        .eq("organization_id", permission.actor.organizationId)
        .eq("employee_id", employeeId),

      supabase
        .from("attendance_records")
        .select("id, status, duty_start, duty_end, total_hours, date")
        .eq("organization_id", permission.actor.organizationId)
        .eq("employee_id", employeeId)
        .gte("date", monthStartStr),

      supabase
        .from("sales_targets")
        .select("id, period, metric, target_value, start_date, end_date")
        .eq("organization_id", permission.actor.organizationId)
        .eq("employee_id", employeeId),
    ]);

    const failedResult = [salesRes, visitsRes, collectionsRes, attendanceRes, targetsRes]
      .find((result) => result.error);
    if (failedResult?.error) {
      return NextResponse.json({ ok: false, error: failedResult.error.message }, { status: 500 });
    }

    const sales = salesRes.data || [];
    const visits = visitsRes.data || [];
    const collections = collectionsRes.data || [];
    const attendance = attendanceRes.data || [];
    const targets = targetsRes.data || [];

    const aggregates = {
      sales: {
        total: sales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0),
        count: sales.length,
        thisMonth: sales
          .filter((s) => String(s.sale_date ?? s.created_at ?? "").slice(0, 10) >= monthStartStr)
          .reduce((sum, s) => sum + Number(s.total_amount || 0), 0),
        thisWeek: sales
          .filter((s) => String(s.sale_date ?? s.created_at ?? "").slice(0, 10) >= weekStartStr)
          .reduce((sum, s) => sum + Number(s.total_amount || 0), 0),
      },
      visits: {
        total: visits.length,
        completed: visits.filter((v) => v.visit_status === "completed").length,
        missed: visits.filter((v) => v.visit_status === "missed").length,
        inProgress: visits.filter((v) => v.visit_status === "in_progress").length,
      },
      collections: {
        total: collections.length,
        approved: collections.filter((c) => c.status === "approved").length,
        pending: collections.filter((c) => c.status === "pending").length,
        amount: collections
          .filter((c) => c.status === "approved")
          .reduce((sum, c) => sum + Number(c.amount || 0), 0),
      },
      attendance: {
        days: attendance.length,
        present: attendance.filter((a) => a.status === "present").length,
        late: attendance.filter((a) => a.status === "late").length,
        absent: attendance.filter((a) => a.status === "absent").length,
        leave: attendance.filter((a) => a.status === "leave").length,
        totalHours: attendance.reduce((sum, a) => sum + Number(a.total_hours || 0), 0),
      },
      targets: targets.filter((target) => target.period === period),
    };

    response = { ok: true, performance: aggregates };
  } else {
    // Owner performance rankings
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().split("T")[0];

    const [
      salesRes,
      visitsRes,
      collectionsRes,
      attendanceRes,
      employeesRes,
      targetsRes,
    ] = await Promise.all([
      supabase
        .from("sales_transactions")
        .select("created_by_profile_id, total_amount, sale_date, created_at, status")
        .eq("organization_id", permission.actor.organizationId)
        .gte("sale_date", monthStartStr)
        .neq("status", "cancelled")
        .neq("status", "void"),

      supabase
        .from("customer_visits")
        .select("employee_id, visit_status, created_at")
        .eq("organization_id", permission.actor.organizationId)
        .gte("created_at", monthStartStr),

      supabase
        .from("collections")
        .select("employee_id, amount, status, created_at")
        .eq("organization_id", permission.actor.organizationId)
        .gte("created_at", monthStartStr),

      supabase
        .from("attendance_records")
        .select("employee_id, status, date, total_hours")
        .eq("organization_id", permission.actor.organizationId)
        .gte("date", monthStartStr),

      supabase
        .from("employees")
        .select("id, profile_id, full_name, designation")
        .eq("organization_id", permission.actor.organizationId),

      supabase
        .from("sales_targets")
        .select("id, employee_id, period, metric, target_value, start_date, end_date")
        .eq("organization_id", permission.actor.organizationId)
        .eq("period", period),
    ]);

    const failedResult = [salesRes, visitsRes, collectionsRes, attendanceRes, employeesRes, targetsRes]
      .find((result) => result.error);
    if (failedResult?.error) {
      return NextResponse.json({ ok: false, error: failedResult.error.message }, { status: 500 });
    }

    const sales = salesRes.data || [];
    const visits = visitsRes.data || [];
    const collections = collectionsRes.data || [];
    const attendance = attendanceRes.data || [];
    const employees = employeesRes.data || [];
    const targets = targetsRes.data || [];

    // Calculate performance metrics per employee
    const performanceMap = new Map();
    employees.forEach((emp) => {
      const empSales = sales.filter((s) => s.created_by_profile_id === emp.profile_id);
      const empVisits = visits.filter((v) => v.employee_id === emp.id);
      const empCollections = collections.filter((c) => c.employee_id === emp.id);
      const empAttendance = attendance.filter((a) => a.employee_id === emp.id);

      const metrics = {
        id: emp.id,
        profileId: emp.profile_id,
        name: emp.full_name,
        designation: emp.designation,
        salesTotal: empSales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0),
        salesCount: empSales.length,
        visitsCompleted: empVisits.filter((v) => v.visit_status === "completed").length,
        visitsTotal: empVisits.length,
        collectionsApproved: empCollections.filter((c) => c.status === "approved").length,
        collectionsTotal: empCollections.length,
        collectionsAmount: empCollections
          .filter((c) => c.status === "approved")
          .reduce((sum, c) => sum + Number(c.amount || 0), 0),
        attendancePresent: empAttendance.filter((a) => a.status === "present").length,
        attendanceDays: empAttendance.length,
        attendanceHours: empAttendance.reduce((sum, a) => sum + Number(a.total_hours || 0), 0),
        targets: targets.filter((target) => target.employee_id === emp.id),
      };

      performanceMap.set(emp.id, metrics);
    });

    const rankedPerformance = Array.from(performanceMap.values())
      .filter((p) => p.salesTotal > 0 || p.visitsTotal > 0)
      .sort((a, b) => b.salesTotal - a.salesTotal); // Sort by sales total

    response = { ok: true, performance: rankedPerformance };
  }

  return NextResponse.json(response);
}

export async function POST(_request: NextRequest) {
  // Could be used to create/update performance targets/settings
  return NextResponse.json({ ok: false, error: "Not implemented" }, { status: 501 });
}
