import type { MemoryStore } from "../brain/memory/business-memory";
import type { StaffMemory } from "../brain/contracts/memory";
import type { StaffAssignment } from "./staff-executor";

export type StaffQueryIntent =
  | "who_on_duty"
  | "who_off_duty"
  | "find_employee"
  | "staff_by_role"
  | "active_staff"
  | "inactive_staff"
  | "show_assignments"
  | "assignment_by_area";

export interface StaffQueryResult {
  ok: boolean;
  message: string;
  error?: string;
  queryType: StaffQueryIntent | null;
}

export function processStaffQuery(
  queryType: StaffQueryIntent | null,
  employeeName: string | null,
  roleName: string | null,
  area: string | null,
  store: MemoryStore,
  assignments: StaffAssignment[]
): StaffQueryResult {
  const allStaff = Array.from(store.staff.values()).filter((s) => s.isActiveDuty !== undefined);

  switch (queryType) {
    case "who_on_duty":
      return handleWhoOnDuty(allStaff);
    case "who_off_duty":
      return handleWhoOffDuty(allStaff);
    case "find_employee":
      return handleFindEmployee(employeeName, allStaff, store);
    case "staff_by_role":
      return handleStaffByRole(roleName, allStaff);
    case "active_staff":
      return handleActiveStaff(allStaff);
    case "inactive_staff":
      return handleInactiveStaff(allStaff);
    case "show_assignments":
      return handleShowAssignments(assignments, allStaff);
    case "assignment_by_area":
      return handleAssignmentByArea(area, assignments, allStaff);
    default:
      return handleStaffSummary(allStaff, assignments);
  }
}

function resolveStaff(name: string, store: MemoryStore): StaffMemory | null {
  const results = store.searchStaff(name, 0.4, 1);
  if (results.length > 0 && results[0].score >= 0.5) return results[0].item;
  for (const [id, s] of store.staff.entries()) {
    if (s.name.toLowerCase() === name.toLowerCase()) return s;
  }
  return null;
}

function handleWhoOnDuty(allStaff: StaffMemory[]): StaffQueryResult {
  const onDuty = allStaff.filter((s) => s.isActiveDuty);
  if (onDuty.length === 0) {
    return { ok: true, message: "No staff are currently on duty.", queryType: "who_on_duty" };
  }
  const items = onDuty.slice(0, 5).map((s) => {
    const role = s.role ? ` (${s.role})` : "";
    const since = s.onDutySince ? ` since ${new Date(s.onDutySince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
    return `${s.name}${role}${since}`;
  });
  const extra = onDuty.length > 5 ? ` And ${onDuty.length - 5} more staff on duty.` : "";
  return {
    ok: true,
    message: `Staff on duty: ${items.join(". ")}.${extra}`,
    queryType: "who_on_duty",
  };
}

function handleWhoOffDuty(allStaff: StaffMemory[]): StaffQueryResult {
  const offDuty = allStaff.filter((s) => !s.isActiveDuty);
  if (offDuty.length === 0) {
    return { ok: true, message: "All staff are currently on duty.", queryType: "who_off_duty" };
  }
  const items = offDuty.slice(0, 5).map((s) => `${s.name}${s.role ? ` (${s.role})` : ""}`);
  const extra = offDuty.length > 5 ? ` And ${offDuty.length - 5} more staff off duty.` : "";
  return {
    ok: true,
    message: `Staff off duty: ${items.join(". ")}.${extra}`,
    queryType: "who_off_duty",
  };
}

function handleFindEmployee(employeeName: string | null, allStaff: StaffMemory[], store: MemoryStore): StaffQueryResult {
  if (!employeeName) {
    return { ok: false, message: "Please tell me the employee name to search for.", error: "MISSING_NAME", queryType: "find_employee" };
  }
  const staff = resolveStaff(employeeName, store);
  if (!staff) {
    return { ok: false, message: `I could not find an employee named ${employeeName}. Please check the name and try again.`, error: "EMPLOYEE_NOT_FOUND", queryType: "find_employee" };
  }
  const status = staff.isActiveDuty ? "on duty" : "off duty";
  const role = staff.role ? ` as ${staff.role}` : "";
  return {
    ok: true,
    message: `${staff.name} is ${status}${role}.`,
    queryType: "find_employee",
  };
}

function handleStaffByRole(roleName: string | null, allStaff: StaffMemory[]): StaffQueryResult {
  if (!roleName) {
    const roles = new Set(allStaff.map((s) => s.role).filter(Boolean));
    if (roles.size === 0) {
      return { ok: true, message: "No role information available for staff.", queryType: "staff_by_role" };
    }
    return { ok: true, message: `Available roles: ${Array.from(roles).join(", ")}.`, queryType: "staff_by_role" };
  }
  const lower = roleName.toLowerCase();
  const matched = allStaff.filter((s) => s.role && s.role.toLowerCase().includes(lower));
  if (matched.length === 0) {
    return { ok: true, message: `No staff found with role ${roleName}.`, queryType: "staff_by_role" };
  }
  const items = matched.slice(0, 5).map((s) => `${s.name}${s.isActiveDuty ? " (on duty)" : " (off duty)"}`);
  const extra = matched.length > 5 ? ` And ${matched.length - 5} more.` : "";
  return {
    ok: true,
    message: `Staff with role ${roleName}: ${items.join(". ")}.${extra}`,
    queryType: "staff_by_role",
  };
}

function handleActiveStaff(allStaff: StaffMemory[]): StaffQueryResult {
  const active = allStaff.filter((s) => s.isActiveDuty);
  if (active.length === 0) {
    return { ok: true, message: "No active staff available.", queryType: "active_staff" };
  }
  const items = active.slice(0, 5).map((s) => `${s.name}${s.role ? ` (${s.role})` : ""}`);
  const extra = active.length > 5 ? ` And ${active.length - 5} more.` : "";
  return {
    ok: true,
    message: `Available staff: ${items.join(". ")}.${extra}`,
    queryType: "active_staff",
  };
}

function handleInactiveStaff(allStaff: StaffMemory[]): StaffQueryResult {
  const inactive = allStaff.filter((s) => !s.isActiveDuty);
  if (inactive.length === 0) {
    return { ok: true, message: "All staff are active.", queryType: "inactive_staff" };
  }
  const items = inactive.slice(0, 5).map((s) => `${s.name}${s.role ? ` (${s.role})` : ""}`);
  const extra = inactive.length > 5 ? ` And ${inactive.length - 5} more inactive staff.` : "";
  return {
    ok: true,
    message: `Inactive staff: ${items.join(". ")}.${extra}`,
    queryType: "inactive_staff",
  };
}

function handleShowAssignments(assignments: StaffAssignment[], allStaff: StaffMemory[]): StaffQueryResult {
  if (assignments.length === 0) {
    return { ok: true, message: "No staff assignments have been made yet.", queryType: "show_assignments" };
  }
  const items = assignments.slice(0, 5).map((a) => `${a.employeeName} assigned to ${a.area}`);
  const extra = assignments.length > 5 ? ` And ${assignments.length - 5} more assignments.` : "";
  return {
    ok: true,
    message: `Current assignments: ${items.join(". ")}.${extra}`,
    queryType: "show_assignments",
  };
}

function handleAssignmentByArea(area: string | null, assignments: StaffAssignment[], allStaff: StaffMemory[]): StaffQueryResult {
  if (!area) {
    return { ok: false, message: "Please tell me the area name to check.", error: "MISSING_AREA", queryType: "assignment_by_area" };
  }
  const assignment = getAssignmentForArea(area, assignments);
  if (!assignment) {
    return { ok: true, message: `No employee is assigned to ${area}.`, queryType: "assignment_by_area" };
  }
  return {
    ok: true,
    message: `${assignment.employeeName} is assigned to ${assignment.area}.`,
    queryType: "assignment_by_area",
  };
}

function getAssignmentForArea(area: string, assignments: StaffAssignment[]): StaffAssignment | undefined {
  const lower = area.toLowerCase();
  return assignments.find((a) => a.area.toLowerCase() === lower);
}

function handleStaffSummary(allStaff: StaffMemory[], assignments: StaffAssignment[]): StaffQueryResult {
  const total = allStaff.length;
  const onDuty = allStaff.filter((s) => s.isActiveDuty).length;
  const offDuty = total - onDuty;
  const assignedCount = assignments.length;
  const parts: string[] = [
    `Staff summary: ${total} total.`,
    `${onDuty} on duty, ${offDuty} off duty.`,
    `${assignedCount} active assignments.`,
  ];
  return {
    ok: true,
    message: parts.join(" "),
    queryType: null,
  };
}
