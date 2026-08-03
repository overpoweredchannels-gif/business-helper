import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { ProfileService } from "@/lib/identity/services/profile-service";

export async function GET(request: Request) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = new ProfileService();
  const profiles = await service.listProfiles(context.actor);

  return NextResponse.json({ profiles });
}
