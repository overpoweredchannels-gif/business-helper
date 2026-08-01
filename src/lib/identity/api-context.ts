import { NextRequest } from "next/server";
import { createSupabaseService } from "../supabase/server";
import { normalizeRole } from "./permissions";
import { RoleType } from "./types";

export interface ApiActor {
  profileId: string;
  organizationId: string;
  email: string | null;
  role: RoleType | null;
  isOwner: boolean;
  isActive: boolean;
}

export async function resolveActor(request: NextRequest): Promise<{ actor?: ApiActor; error?: string; status?: number }> {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return { error: "Missing authorization token.", status: 401 };
  }
  const token = authorization.slice(7).trim();

  let supabase;
  try {
    supabase = createSupabaseService();
  } catch (err) {
    return {
      error: `Supabase is not configured: ${err instanceof Error ? err.message : String(err)}`,
      status: 500,
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return { error: "Invalid or expired session token.", status: 401 };
  }
  const userId = userData.user.id;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return { error: `Profile lookup failed: ${profileError.message}`, status: 500 };
  }
  if (!profile) {
    return { error: "No workspace profile found for this user.", status: 404 };
  }
  if (profile.is_active === false) {
    return { error: "This account has been deactivated.", status: 403 };
  }

  const role = normalizeRole(profile.role);
  return {
    actor: {
      profileId: profile.id,
      organizationId: profile.organization_id,
      email: userData.user.email ?? null,
      role,
      isOwner: role === "owner",
      isActive: profile.is_active !== false,
    },
  };
}
