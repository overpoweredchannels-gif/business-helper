import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { ProfileService } from "@/lib/identity/services/profile-service";
import { staffRoles } from "@/lib/tradeos/constants";

export async function GET(request: Request) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const service = new ProfileService();
  const profiles = await service.listProfiles(permission.actor);

  return NextResponse.json({ profiles });
}

export async function PATCH(request: Request) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const profileId = typeof body.profile_id === "string" ? body.profile_id : "";
  if (!profileId || typeof body.role !== "string" || !staffRoles.includes(body.role) || typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "A profile, valid role, and account status are required." }, { status: 400 });
  }
  if (body.display_name !== null && typeof body.display_name !== "string") {
    return NextResponse.json({ error: "Staff display name is invalid." }, { status: 400 });
  }

  try {
    const service = new ProfileService();
    const profile = await service.updateStaffProfile(permission.actor, profileId, body);
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update staff profile." }, { status: 400 });
  }
}
