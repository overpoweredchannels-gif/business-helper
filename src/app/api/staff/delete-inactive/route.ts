import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "import_export");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const orgId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  try {
    // First, get the IDs of inactive profiles
    const { data: inactiveProfiles, error: fetchError } = await supabase
      .from("profiles")
      .select("id")
      .eq("organization_id", orgId)
      .eq("is_active", false);

    if (fetchError) throw fetchError;

    if (!inactiveProfiles || inactiveProfiles.length === 0) {
      return NextResponse.json({ ok: true, deletedCount: 0 });
    }

    const profileIds = inactiveProfiles.map((p) => p.id);

    // Delete staff_permissions for those profiles
    const { error: permError } = await supabase
      .from("staff_permissions")
      .delete()
      .in("profile_id", profileIds);
    if (permError) throw permError;

    // Delete the inactive profiles
    const { error: profileError, count } = await supabase
      .from("profiles")
      .delete()
      .eq("organization_id", orgId)
      .eq("is_active", false);
    if (profileError) throw profileError;

    return NextResponse.json({ ok: true, deletedCount: count ?? profileIds.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete inactive staff";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}