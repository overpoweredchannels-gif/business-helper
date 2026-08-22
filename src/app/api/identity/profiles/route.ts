import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { ProfileService } from "@/lib/identity/services/profile-service";

export async function GET(request: Request) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const service = new ProfileService();
  const profiles = await service.listProfiles(permission.actor);

  return NextResponse.json({ profiles });
}
