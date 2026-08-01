export interface StaffAssignment {
  employeeId: string;
  employeeName: string;
  area: string;
  createdAt: string;
}

export interface StaffResult {
  ok: boolean;
  message: string;
  error?: string;
  assignment?: StaffAssignment;
}

export interface StaffInput {
  employee_id?: string;
  employee_name?: string;
  area?: string;
}

const staffAssignments = new Map<string, StaffAssignment>();

export function getStaffAssignments(): StaffAssignment[] {
  return Array.from(staffAssignments.values());
}

export function getAssignmentForEmployee(employeeId: string): StaffAssignment | undefined {
  return staffAssignments.get(employeeId);
}

export function getAssignmentForArea(area: string): StaffAssignment | undefined {
  const lower = area.toLowerCase();
  for (const assignment of staffAssignments.values()) {
    if (assignment.area.toLowerCase() === lower) return assignment;
  }
  return undefined;
}

export function assignEmployee(data: StaffInput): StaffResult {
  if (!data.employee_id) {
    return { ok: false, message: "Employee ID is required.", error: "MISSING_EMPLOYEE_ID" };
  }
  if (!data.area) {
    return { ok: false, message: "Area is required for assignment.", error: "MISSING_AREA" };
  }

  const existing = staffAssignments.get(data.employee_id);
  if (existing) {
    return { ok: false, message: `${existing.employeeName} is already assigned to ${existing.area}. Please use reassign to change.`, error: "DUPLICATE_ASSIGNMENT" };
  }

  const assignment: StaffAssignment = {
    employeeId: data.employee_id,
    employeeName: data.employee_name || "Employee",
    area: data.area,
    createdAt: new Date().toISOString(),
  };
  staffAssignments.set(data.employee_id, assignment);
  return { ok: true, message: `${assignment.employeeName} has been assigned to ${assignment.area}.`, assignment };
}

export function reassignEmployee(data: StaffInput): StaffResult {
  if (!data.employee_id) {
    return { ok: false, message: "Employee ID is required.", error: "MISSING_EMPLOYEE_ID" };
  }
  if (!data.area) {
    return { ok: false, message: "New area is required for reassignment.", error: "MISSING_AREA" };
  }

  const existing = staffAssignments.get(data.employee_id);
  const name = data.employee_name || existing?.employeeName || "Employee";

  const assignment: StaffAssignment = {
    employeeId: data.employee_id,
    employeeName: name,
    area: data.area,
    createdAt: new Date().toISOString(),
  };
  staffAssignments.set(data.employee_id, assignment);
  const oldArea = existing ? ` from ${existing.area}` : "";
  return { ok: true, message: `${name} has been reassigned to ${data.area}${oldArea}.`, assignment };
}

export function removeEmployee(data: StaffInput): StaffResult {
  if (!data.employee_id) {
    return { ok: false, message: "Employee ID is required.", error: "MISSING_EMPLOYEE_ID" };
  }

  const existing = staffAssignments.get(data.employee_id);
  if (!existing) {
    const name = data.employee_name || "Employee";
    return { ok: false, message: `${name} has no active assignment to remove.`, error: "NO_ASSIGNMENT" };
  }

  staffAssignments.delete(data.employee_id);
  return { ok: true, message: `${existing.employeeName} has been removed from ${existing.area}.` };
}

export function clearAssignments(): void {
  staffAssignments.clear();
}

export function validateStaffInput(data: StaffInput): string[] {
  const errors: string[] = [];
  if (!data.employee_id) errors.push("employee_id is required");
  return errors;
}
