import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { ProfileService } from "@/lib/identity/services/profile-service";

export async function GET(request: Request) {
  const context = await resolveActor(request);
  if (!context.actor?.profileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = new ProfileService();
  const profile = await service.getCurrentProfile(context.actor);

  return NextResponse.json({ profile });
}

export async function PATCH(request: Request) {
  const context = await resolveActor(request);
  if (!context.actor?.profileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const service = new ProfileService();
  const updated = await service.updateProfile(context.actor, body);

  return NextResponse.json({ profile: updated });
}
