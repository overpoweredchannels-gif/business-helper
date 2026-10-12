import type { EmployeeDesignation } from "@/lib/tradeos/types";

export const DEFAULT_STAFF_DESIGNATION: EmployeeDesignation = "salesman";

const PROFILE_ROLE_BY_DESIGNATION: Record<EmployeeDesignation, string> = {
  salesman: "salesman",
  delivery_rider: "delivery_rider",
  field_officer: "field_officer",
  collection_officer: "collection_officer",
  supervisor: "supervisor",
  manager: "manager",
  owner: "owner",
};

export function getStaffProfileRole(designation?: string | null): string {
  if (!designation) return DEFAULT_STAFF_DESIGNATION;
  return Object.hasOwn(PROFILE_ROLE_BY_DESIGNATION, designation)
    ? PROFILE_ROLE_BY_DESIGNATION[designation as EmployeeDesignation]
    : DEFAULT_STAFF_DESIGNATION;
}
