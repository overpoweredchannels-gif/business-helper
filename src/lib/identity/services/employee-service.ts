import { EmployeeRepository, EmployeeRecord } from "../repositories/employee-repository";
import type { ActorContext } from "../types";

export class EmployeeService {
  constructor(private readonly repository = new EmployeeRepository()) {}

  async listEmployees(actor: ActorContext) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    return this.repository.findByOrganization(actor.organizationId);
  }

  async createEmployee(actor: ActorContext, input: Record<string, unknown>) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    return this.repository.create({
      organization_id: actor.organizationId,
      profile_id: input.profile_id as string,
      role: input.role as string | null,
      is_active: input.is_active as boolean | null,
      metadata: (input.metadata as Record<string, unknown>) ?? {},
    });
  }

  async updateEmployee(actor: ActorContext, employeeId: string, updates: Record<string, unknown>) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    return this.repository.update(employeeId, updates as Partial<EmployeeRecord>);
  }

  async removeEmployee(actor: ActorContext, employeeId: string) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    return this.repository.remove(employeeId);
  }
}
