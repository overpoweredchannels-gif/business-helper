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

    // Allowlist: a user may only ever edit their own display name / email.
    // Role, organization, activation state and identity fields can never be
    // changed through the self-profile endpoint — those go through the
    // owner-gated staff management flow (saveStaffProfile) instead.
    const allowlisted: Partial<ProfileRecord> = {};
    for (const key of ["full_name", "display_name", "email"] as const) {
      if (key in updates) {
        (allowlisted as Record<string, unknown>)[key] = updates[key];
      }
    }

    return this.repository.update(actor.profileId, allowlisted);
  }
}
