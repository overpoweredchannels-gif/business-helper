import { NextResponse } from "next/server";
import { AuditRepository } from "@/lib/audit/audit-repository";
import { resolveActor } from "@/lib/identity/api-context";
import { createSupabaseService } from "@/lib/supabase/server";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export async function PATCH(request: Request) {
  const context = await resolveActor(request);
  const actor = context.actor;
  if (!actor) {
    return NextResponse.json({ ok: false, error: context.error ?? "Unauthorized" }, { status: context.status ?? 401 });
  }
  if (!actor.isOwner && actor.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Only the owner can change duty hours." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const dutyStart = typeof body.dutyStart === "string" ? body.dutyStart.trim() : "";
  const dutyEnd = typeof body.dutyEnd === "string" ? body.dutyEnd.trim() : "";
  if (!TIME_PATTERN.test(dutyStart) || !TIME_PATTERN.test(dutyEnd)) {
    return NextResponse.json({ ok: false, error: "Duty start and end must use HH:MM time format." }, { status: 400 });
  }
  if (timeToMinutes(dutyStart) >= timeToMinutes(dutyEnd)) {
    return NextResponse.json({ ok: false, error: "Duty end must be later than duty start on the same day." }, { status: 400 });
  }

  const supabase = createSupabaseService();
  const { data: organization, error: lookupError } = await supabase
    .from("organizations")
    .select("id, working_hours")
    .eq("id", actor.organizationId)
    .single();
  if (lookupError || !organization) {
    return NextResponse.json({ ok: false, error: lookupError?.message ?? "Organization not found." }, { status: 404 });
  }

  const previous = organization.working_hours && typeof organization.working_hours === "object"
    ? organization.working_hours as Record<string, unknown>
    : {};
  const workingHours = {
    ...previous,
    duty_start: dutyStart,
    duty_end: dutyEnd,
    timezone: typeof previous.timezone === "string" && previous.timezone ? previous.timezone : "Asia/Karachi",
  };

  const { error: updateError } = await supabase
    .from("organizations")
    .update({ working_hours: workingHours })
    .eq("id", actor.organizationId);
  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  try {
    await new AuditRepository(supabase).create({
      organization_id: actor.organizationId,
      actor_profile_id: actor.profileId,
      actor_email: actor.email,
      action: "updated",
      entity_type: "duty_schedule",
      entity_id: actor.organizationId,
      description: `Updated duty schedule from ${dutyStart} to ${dutyEnd}`,
      old_values: { working_hours: previous },
      new_values: { working_hours: workingHours },
    });
  } catch (auditError) {
    console.error("Duty schedule was saved but its audit entry failed", auditError);
  }

  return NextResponse.json({
    ok: true,
    workingHours,
    message: "Duty schedule saved. It applies when the next duty session starts.",
  });
}
