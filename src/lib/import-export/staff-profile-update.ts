export type StaffProfileUpdater = (profileId: string, updates: Record<string, unknown>) => Promise<unknown>;

export function canImportStaffEntity(entityKey: string, isOwner: boolean): boolean {
  return !["staff", "employees"].includes(entityKey) || isOwner;
}

export async function updateImportedStaffProfile(
  profileId: string,
  updates: { display_name: unknown; role: unknown; is_active: unknown },
  updateProfile?: StaffProfileUpdater,
) {
  if (!updateProfile) throw new Error("Owner-authorized staff profile updater required.");
  return updateProfile(profileId, updates);
}
