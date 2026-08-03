import { OrganizationRepository } from "../repositories/organization-repository";
import type { ActorContext } from "../types";

export class OrganizationService {
  constructor(private readonly repository = new OrganizationRepository()) {}

  async getCurrentOrganization(actor: ActorContext) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    return this.repository.findById(actor.organizationId);
  }

  async updateSettings(actor: ActorContext, settings: Record<string, unknown>) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    return this.repository.updateSettings(actor.organizationId, settings);
  }
}
