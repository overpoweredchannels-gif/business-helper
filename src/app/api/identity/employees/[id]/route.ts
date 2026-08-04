import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requirePermission } from "@/lib/identity/authorization";
import { EmployeeService } from "@/lib/identity/services/employee-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requirePermission(request, "administration");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const service = new EmployeeService();
  const employee = await service.getEmployee(permission.actor, id);

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  return NextResponse.json({ employee });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const service = new EmployeeService();
  const result = await service.updateEmployee(permission.actor, id, body);

  if (result.error || !result.employee) {
    return NextResponse.json({ error: result.error ?? "Failed to update employee" }, { status: 400 });
  }

  return NextResponse.json({ employee: result.employee });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const service = new EmployeeService();
  const result = await service.removeEmployee(permission.actor, id);

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Failed to delete employee" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
