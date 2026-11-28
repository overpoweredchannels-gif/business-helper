import { applyCors, corsHeadersFor, desktopPreflightResponse } from "@/lib/desktop/cors";
import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requirePermission } from "@/lib/identity/authorization";
import { EmployeeService } from "@/lib/identity/services/employee-service";

async function runGET(request: NextRequest) {
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

async function runPOST(request: NextRequest) {
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

export function OPTIONS(request: NextRequest) {
  return desktopPreflightResponse(request, "GET, POST");
}

export async function GET(request: NextRequest) {
  const headers = corsHeadersFor(request);
  try {
    return applyCors(await runGET(request), headers);
  } catch (error) {
    console.error("Cloud identity/employees GET failed:", error);
    return applyCors(NextResponse.json({ error: "Unable to complete the request." }, { status: 500 }), headers);
  }
}

export async function POST(request: NextRequest) {
  const headers = corsHeadersFor(request);
  try {
    return applyCors(await runPOST(request), headers);
  } catch (error) {
    console.error("Cloud identity/employees POST failed:", error);
    return applyCors(NextResponse.json({ error: "Unable to complete the request." }, { status: 500 }), headers);
  }
}
