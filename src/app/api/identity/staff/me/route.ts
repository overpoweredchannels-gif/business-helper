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

  // books_currency arrives with an additive migration that may not
  // have run yet; until the column exists the widened select fails
  // with 42703, so fall back to the select without it — the books
  // currency then resolves from regional_preferences, exactly like the
  // main page's organization read (same pattern, same behaviour).
  let organizationResult = await supabase
    .from("organizations")
    .select("name, working_hours, regional_preferences, books_currency")
    .eq("id", context.actor.organizationId)
    .maybeSingle();

  if (
    organizationResult.error &&
    (organizationResult.error.code === "42703" ||
      organizationResult.error.message?.includes("books_currency"))
  ) {
    organizationResult = await supabase
      .from("organizations")
      .select("name, working_hours, regional_preferences")
      .eq("id", context.actor.organizationId)
      .maybeSingle();
  }

  const { data: organization, error: organizationError } = organizationResult;

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
        regional_preferences: organization?.regional_preferences ?? null,
        books_currency: (organization as { books_currency?: unknown } | null)?.books_currency ?? null,
      },
      permissions,
    },
  });
}
