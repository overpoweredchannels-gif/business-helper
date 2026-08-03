import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { EmployeeService } from "@/lib/identity/services/employee-service";

export async function GET(request: Request) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = new EmployeeService();
  const employees = await service.listEmployees(context.actor);

  return NextResponse.json({ employees });
}

export async function POST(request: Request) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const service = new EmployeeService();
  const employee = await service.createEmployee(context.actor, body);

  return NextResponse.json({ employee });
}
