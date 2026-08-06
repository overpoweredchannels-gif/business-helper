import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { validateStaffPassword } from "@/lib/identity/staff-invitation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "administration");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const employeeId = (body.employeeId as string) ?? "";
  const newPassword = (body.newPassword as string) ?? "";

  if (!employeeId) {
    return NextResponse.json({ ok: false, error: "employeeId is required" }, { status: 400 });
  }
  const passwordError = validateStaffPassword(newPassword);
  if (passwordError) {
    return NextResponse.json({ ok: false, error: passwordError }, { status: 400 });
  }

  const supabase = createSupabaseService();

  const { data: employee } = await supabase
    .from("employees")
    .select("id, full_name, profile_id, hidden_email, status")
    .eq("id", employeeId)
    .eq("organization_id", permission.actor.organizationId)
    .maybeSingle();

  if (!employee) {
    return NextResponse.json({ ok: false, error: "Employee not found in this organization" }, { status: 404 });
  }
  if (!employee.profile_id) {
    return NextResponse.json({ ok: false, error: "This employee has no linked auth account yet" }, { status: 400 });
  }

  const { error } = await supabase.auth.admin.updateUserById(employee.profile_id, { password: newPassword });

  if (error) {
    return NextResponse.json({ ok: false, error: `Failed to reset password: ${error.message}` }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: "Password reset successfully and saved to the staff account.",
    employeeId: employee.id,
  });
}