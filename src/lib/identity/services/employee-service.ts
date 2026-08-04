import { EmployeeRepository, EmployeeInput, isEmployeeDesignation } from "../repositories/employee-repository";
import type { ActorContext } from "../types";
import { Employee } from "@/lib/tradeos/types";

export type EmployeeResult = { employee?: Employee; error?: string };

export class EmployeeService {
  constructor(private readonly repository = new EmployeeRepository()) {}

  async listEmployees(actor: ActorContext): Promise<Employee[]> {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }
    return this.repository.findByOrganization(actor.organizationId);
  }

  async getEmployee(actor: ActorContext, employeeId: string): Promise<Employee | null> {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }
    return this.repository.findById(employeeId);
  }

  validateEmployeeInput(input: Record<string, unknown>): string | null {
    const fullName = (input.full_name as string) ?? "";
    if (!fullName.trim()) {
      return "Employee name is required.";
    }
    if (fullName.trim().length > 200) {
      return "Employee name must be 200 characters or fewer.";
    }

    const designation = (input.designation as string) ?? "";
    if (designation && !isEmployeeDesignation(designation)) {
      return `Unknown designation "${designation}". Allowed: salesman, delivery_rider, field_officer, collection_officer, supervisor, manager, owner.`;
    }

    if (input.phone && String(input.phone).length > 30) {
      return "Phone number is too long.";
    }
    if (input.cnic && String(input.cnic).length > 30) {
      return "CNIC is too long.";
    }
    if (input.email && String(input.email).length > 150) {
      return "Email is too long.";
    }

    if (input.emergency_contact !== undefined && input.emergency_contact !== null) {
      const ec = input.emergency_contact as Record<string, unknown>;
      if (typeof ec !== "object") {
        return "Emergency contact must be an object with name/phone/relation.";
      }
    }

    return null;
  }

  async createEmployee(actor: ActorContext, input: Record<string, unknown>): Promise<EmployeeResult> {
    if (!actor.organizationId) {
      return { error: "Organization context required" };
    }

    const validationError = this.validateEmployeeInput(input);
    if (validationError) {
      return { error: validationError };
    }

    const payload: EmployeeInput = {
      organization_id: actor.organizationId,
      profile_id: (input.profile_id as string) ?? null,
      employee_id: (input.employee_id as string) ?? null,
      full_name: (input.full_name as string)?.trim(),
      phone: (input.phone as string) ?? null,
      cnic: (input.cnic as string) ?? null,
      email: (input.email as string) ?? null,
      designation: ((input.designation as string) || "salesman") as EmployeeInput["designation"],
      department: (input.department as string) ?? null,
      joining_date: (input.joining_date as string) ?? null,
      status: (input.status as EmployeeInput["status"]) ?? "active",
      assigned_supervisor_id: (input.assigned_supervisor_id as string) ?? null,
      assigned_territory_id: (input.assigned_territory_id as string) ?? null,
      assigned_route_id: (input.assigned_route_id as string) ?? null,
      photo_url: (input.photo_url as string) ?? null,
      emergency_contact: (input.emergency_contact as Employee["emergency_contact"]) ?? null,
      is_active: input.is_active !== false,
    };

    try {
      const employee = await this.repository.create(payload);
      return { employee };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to create employee" };
    }
  }

  async updateEmployee(actor: ActorContext, employeeId: string, updates: Record<string, unknown>): Promise<EmployeeResult> {
    if (!actor.organizationId) {
      return { error: "Organization context required" };
    }

    const validationError = this.validateEmployeeInput(updates);
    if (validationError) {
      return { error: validationError };
    }

    const payload: EmployeeInput = {};
    const allowedFields: (keyof Employee)[] = [
      "profile_id", "employee_id", "full_name", "phone", "cnic", "email",
      "designation", "department", "joining_date", "status", "assigned_supervisor_id",
      "assigned_territory_id", "assigned_route_id", "photo_url", "emergency_contact", "is_active",
    ];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        (payload as Record<string, unknown>)[field] = updates[field];
      }
    }

    try {
      const employee = await this.repository.update(employeeId, payload);
      return { employee };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to update employee" };
    }
  }

  async removeEmployee(actor: ActorContext, employeeId: string): Promise<{ success: boolean; error?: string }> {
    if (!actor.organizationId) {
      return { success: false, error: "Organization context required" };
    }
    try {
      await this.repository.remove(employeeId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Failed to remove employee" };
    }
  }
}
