import { supabase } from "./client";

/**
 * Browser-side JWT claim helpers.
 *
 * GoTrue embeds admin-set custom claims under `app_metadata` in every access
 * token issued AFTER the claim is written. A token issued before provisioning
 * (e.g. the token minted during the Google OAuth code exchange) does not
 * contain the claim, and supabase-js only auto-refreshes near expiry. These
 * helpers force a session refresh after provisioning so the browser token
 * immediately carries the organization_id claim that current_org_id() reads
 * for RLS.
 */

const decodeTokenPayload = (token: string): Record<string, unknown> | null => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const getOrganizationClaim = (accessToken?: string | null): string | null => {
  if (!accessToken) return null;
  const payload = decodeTokenPayload(accessToken);
  if (!payload) return null;

  const appMetadata = payload.app_metadata as Record<string, unknown> | undefined;
  const userMetadata = payload.user_metadata as Record<string, unknown> | undefined;
  const claim =
    appMetadata?.organization_id ?? userMetadata?.organization_id ?? payload.organization_id;

  return typeof claim === "string" && claim ? claim : null;
};

/**
 * Ensures the browser's current access token carries the organization_id
 * claim. Refreshes the session once if the claim is missing (the refresh
 * token is exchanged for a fresh access token minted from the current
 * auth.users row, which provisioning has updated). Returns true when the
 * claim is present in the resulting token.
 */
export const ensureOrganizationClaimInSession = async (): Promise<boolean> => {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return false;

    if (getOrganizationClaim(token)) return true;

    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      console.warn("ensureOrganizationClaimInSession: refresh failed:", error?.message);
      return false;
    }

    const claim = getOrganizationClaim(data.session.access_token);
    if (!claim) {
      console.warn("ensureOrganizationClaimInSession: refreshed token still lacks organization_id claim");
      return false;
    }

    console.log("ensureOrganizationClaimInSession: organization_id claim present after refresh");
    return true;
  } catch (err) {
    console.warn("ensureOrganizationClaimInSession: unexpected error:", err);
    return false;
  }
};
