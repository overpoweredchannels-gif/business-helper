import type { EmployeeDesignation } from "@/lib/tradeos/types";

export const DEFAULT_STAFF_DESIGNATION: EmployeeDesignation = "salesman";

export const EMPLOYEE_DESIGNATIONS: readonly EmployeeDesignation[] = [
  "salesman", "delivery_rider", "field_officer", "collection_officer",
  "supervisor", "manager", "owner", "purchase_officer", "warehouse_staff", "viewer",
];

export function isEmployeeDesignation(value: string): value is EmployeeDesignation {
  return EMPLOYEE_DESIGNATIONS.some((designation) => designation === value);
}

export function getStaffProfileRole(designation?: string | null): string {
  return designation && isEmployeeDesignation(designation) ? designation : DEFAULT_STAFF_DESIGNATION;
}
