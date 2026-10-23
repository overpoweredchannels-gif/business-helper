import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { createSupabaseService } from "@/lib/supabase/server";
import { selectWithColumnFallback } from "@/lib/supabase/select-with-column-fallback";

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

  // books_currency and regional_preferences arrive with additive
  // migrations that may not have run yet; until a column exists the
  // widened select fails with 42703, so the shared tolerant read drops
  // each missing column down to the floor list — the books currency
  // then resolves from regional_preferences when present, exactly like
  // the main page's organization read (same helper, same behaviour).
  // The previous fallback kept regional_preferences at every level, so
  // a database without that column failed the whole profile load.
  const organizationId = context.actor.organizationId;
  const organizationResult = await selectWithColumnFallback<any>({
    columns: ["name", "working_hours", "regional_preferences", "books_currency"],
    floor: ["name", "working_hours"],
    run: (columns) =>
      supabase
        .from("organizations")
        .select(columns.join(", "))
        .eq("id", organizationId)
        .maybeSingle(),
  });

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
