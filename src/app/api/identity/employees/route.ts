import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requirePermission } from "@/lib/identity/authorization";
import { EmployeeService } from "@/lib/identity/services/employee-service";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "administration");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  try {
    const service = new EmployeeService();
    const employees = await service.listEmployees(permission.actor);
    return NextResponse.json({ employees });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load employees";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const service = new EmployeeService();
  const result = await service.createEmployee(permission.actor, body);

  if (result.error || !result.employee) {
    return NextResponse.json({ error: result.error ?? "Failed to create employee" }, { status: 400 });
  }

  return NextResponse.json({ employee: result.employee });
}
