import { ProfileRepository, ProfileRecord } from "../repositories/profile-repository";
import type { ActorContext } from "../types";

export class ProfileService {
  constructor(private readonly repository = new ProfileRepository()) {}

  async getCurrentProfile(actor: ActorContext) {
    if (!actor.profileId) {
      throw new Error("Profile context required");
    }

    return this.repository.findById(actor.profileId);
  }

  async listProfiles(actor: ActorContext) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    return this.repository.findByOrganization(actor.organizationId);
  }

  async updateProfile(actor: ActorContext, updates: Record<string, unknown>) {
    if (!actor.profileId) {
      throw new Error("Profile context required");
    }

    return this.repository.update(actor.profileId, updates as Partial<ProfileRecord>);
  }
}
