import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  const { data: employee } = await supabase
    .from("employees")
    .select("id, full_name, designation")
    .eq("profile_id", permission.actor.profileId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (!employee) {
    return NextResponse.json({ ok: false, error: "No supervisor employee profile found" }, { status: 404 });
  }

  const today = new Date().toISOString().split("T")[0];

  const [{ data: team, error: teamError }, { data: attendance, error: attError }, { data: visits, error: visError }] =
    await Promise.all([
      supabase
        .from("employees")
        .select("id, employee_id, full_name, phone, designation, profile_id, status, photo_url")
        .eq("organization_id", organizationId)
        .eq("assigned_supervisor_id", employee.id)
        .eq("is_active", true)
        .order("full_name", { ascending: true }),

      supabase
        .from("attendance_records")
        .select("id, employee_id, status, duty_start, date")
        .eq("organization_id", organizationId)
        .eq("date", today),

      supabase
        .from("customer_visits")
        .select("id, employee_id, visit_status, created_at")
        .eq("organization_id", organizationId)
        .gte("created_at", `${today}T00:00:00`)
        .lte("created_at", `${today}T23:59:59.999`),
    ]);

  if (teamError || attError || visError) {
    return NextResponse.json(
      { ok: false, error: teamError?.message || attError?.message || visError?.message || "Query error" },
      { status: 500 }
    );
  }

  const attByEmp = new Map<string, (typeof attendance)[number]>();
  for (const a of attendance || []) attByEmp.set(a.employee_id, a);

  const visitsByEmp = new Map<string, (typeof visits)[number][]>();
  for (const v of visits || []) {
    const list = visitsByEmp.get(v.employee_id) || [];
    list.push(v);
    visitsByEmp.set(v.employee_id, list);
  }

  const members = (team || []).map((m) => {
    const att = attByEmp.get(m.id);
    const empVisits = visitsByEmp.get(m.id) || [];
    return {
      id: m.id,
      employee_id: m.employee_id,
      full_name: m.full_name,
      phone: m.phone,
      designation: m.designation,
      status: m.status,
      photo_url: m.photo_url,
      attendance: att
        ? { status: att.status, duty_at: att.duty_start }
        : { status: "no_record", duty_at: null },
      visits: {
        total: empVisits.length,
        completed: empVisits.filter((v) => v.visit_status === "completed").length,
        inProgress: empVisits.filter((v) => v.visit_status === "in_progress").length,
        planned: empVisits.filter((v) => v.visit_status === "planned").length,
      },
    };
  });

  const presentToday = members.filter((m) => m.attendance.status === "present").length;
  const onDutyToday =
    members.filter((m) => m.attendance.status === "present" || m.attendance.status === "late").length;

  return NextResponse.json({
    ok: true,
    supervisor: { id: employee.id, full_name: employee.full_name, designation: employee.designation },
    members,
    stats: {
      total: members.length,
      presentToday,
      onDutyToday,
      absentToday: members.filter((m) => m.attendance.status === "absent").length,
      noRecord: members.filter((m) => m.attendance.status === "no_record").length,
      visitsToday: (team || []).reduce((sum, m) => sum + (visitsByEmp.get(m.id)?.length ?? 0), 0),
    },
  });
}