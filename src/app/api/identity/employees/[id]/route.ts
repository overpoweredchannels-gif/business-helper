import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { EmployeeService } from "@/lib/identity/services/employee-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const service = new EmployeeService();
  const employee = await service.updateEmployee(context.actor, id, body);

  return NextResponse.json({ employee });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const service = new EmployeeService();
  await service.removeEmployee(context.actor, id);

  return NextResponse.json({ success: true });
}
