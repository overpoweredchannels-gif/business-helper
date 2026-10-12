import { ProfileRepository, ProfileRecord } from "../repositories/profile-repository";
import type { ActorContext } from "../types";
import { staffRoles } from "@/lib/tradeos/constants";

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

  async updateStaffProfile(actor: ActorContext, profileId: string, updates: Record<string, unknown>) {
    if (!actor.isOwner) throw new Error("Owner access required.");
    if (!actor.organizationId) throw new Error("Organization context required.");
    if (!profileId) throw new Error("Staff profile is required.");
    if (typeof updates.role !== "string" || !staffRoles.includes(updates.role)) {
      throw new Error("Choose a valid staff role.");
    }
    if (typeof updates.is_active !== "boolean") throw new Error("Staff account status is invalid.");
    if (updates.display_name !== null && typeof updates.display_name !== "string") {
      throw new Error("Staff display name is invalid.");
    }
    if (profileId === actor.profileId && updates.is_active === false) {
      throw new Error("You cannot deactivate your own account.");
    }
    if (profileId === actor.profileId && actor.role === "owner" && updates.role !== "owner") {
      throw new Error("You cannot remove your own owner role.");
    }

    return this.repository.updateInOrganization(profileId, actor.organizationId, {
      display_name: typeof updates.display_name === "string" ? updates.display_name.trim() || null : null,
      role: updates.role,
      is_active: updates.is_active,
    });
  }

  async linkCurrentAuthUser(actor: ActorContext) {
    if (!actor.profileId) throw new Error("Profile context required.");
    return this.repository.linkAuthUser(actor.profileId);
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
