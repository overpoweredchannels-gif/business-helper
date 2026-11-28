import { applyCors, corsHeadersFor, desktopPreflightResponse } from "@/lib/desktop/cors";
import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requirePermission } from "@/lib/identity/authorization";
import { EmployeeService } from "@/lib/identity/services/employee-service";

async function runGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

async function runPATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

async function runDELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

export function OPTIONS(request: NextRequest) {
  return desktopPreflightResponse(request, "GET, PATCH, DELETE");
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const headers = corsHeadersFor(request);
  try {
    return applyCors(await runGET(request, context), headers);
  } catch (error) {
    console.error("Cloud identity/employees/[id] GET failed:", error);
    return applyCors(NextResponse.json({ error: "Unable to complete the request." }, { status: 500 }), headers);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const headers = corsHeadersFor(request);
  try {
    return applyCors(await runPATCH(request, context), headers);
  } catch (error) {
    console.error("Cloud identity/employees/[id] PATCH failed:", error);
    return applyCors(NextResponse.json({ error: "Unable to complete the request." }, { status: 500 }), headers);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const headers = corsHeadersFor(request);
  try {
    return applyCors(await runDELETE(request, context), headers);
  } catch (error) {
    console.error("Cloud identity/employees/[id] DELETE failed:", error);
    return applyCors(NextResponse.json({ error: "Unable to complete the request." }, { status: 500 }), headers);
  }
}
