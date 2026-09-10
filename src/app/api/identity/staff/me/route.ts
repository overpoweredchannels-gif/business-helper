import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await resolveActor(request);
  if (!context.actor?.profileId || !context.actor.organizationId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseService();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, email, role, is_active, display_name, login_id, phone, full_name")
    .eq("id", context.actor.profileId)
    .eq("organization_id", context.actor.organizationId)
    .maybeSingle();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select(
      "id, organization_id, profile_id, employee_id, full_name, phone, cnic, email, designation, department, joining_date, status, assigned_supervisor_id, assigned_territory_id, assigned_route_id, photo_url, is_active"
    )
    .eq("profile_id", context.actor.profileId)
    .eq("organization_id", context.actor.organizationId)
    .maybeSingle();

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("name, working_hours")
    .eq("id", context.actor.organizationId)
    .maybeSingle();

  const { data: permissions, error: permissionsError } = await supabase
    .from("staff_permissions")
    .select("*")
    .eq("profile_id", context.actor.profileId)
    .eq("organization_id", context.actor.organizationId)
    .maybeSingle();

  if (profileError || employeeError || organizationError || permissionsError) {
    return NextResponse.json({ ok: false, error: "Could not load your complete staff profile. Please retry." }, { status: 500 });
  }
  if (!profile || profile.is_active === false || (employee && (employee.is_active === false || ["inactive", "archived"].includes(employee.status)))) {
    return NextResponse.json({ ok: false, error: "This staff profile is inactive or unavailable." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    me: {
      profile,
      employee,
      organization: {
        name: organization?.name ?? null,
        working_hours: organization?.working_hours ?? null,
      },
      permissions,
    },
  });
}
