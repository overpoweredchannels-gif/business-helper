/**
 * Cloud-endpoint helper (HYBRID Slice 1).
 *
 * The desktop (Electron) build has no SUPABASE_SERVICE_ROLE_KEY, so CLOUD
 * routes cannot run on the local standalone server — they must run on the
 * production Vercel deployment, called with the signed-in user's Bearer
 * token. This module is the ONLY place renderer code may fetch a CLOUD
 * route: the CI gate (scripts/check-desktop-routes.mjs, check 5) excludes
 * exactly this file and fails any other direct fetch of a migrated CLOUD
 * route. Every later slice (staff login, currency, AI) adds its calls here.
 *
 * Origin: on the web the page is served by Vercel itself, so the relative
 * path is the cloud endpoint. On desktop the page is served by the local
 * standalone server (random loopback port), so the call goes to the
 * production Vercel origin. NEXT_PUBLIC_CLOUD_ORIGIN overrides the origin
 * for tests; otherwise the production deployment is used.
 *
 * Timeout (hardening rule 6 spirit): every cloud call has a ~10s timeout
 * so a spinner can never hang. A timeout throws a "timed out" error so the
 * desktop offline handling (isNetworkError) treats it as a network
 * failure, not a sign-out.
 */
import { isDesktopApp } from "@/lib/offline/identity-cache";
import { getAccessToken } from "@/lib/tradeos/authorized-fetch";

const CLOUD_ORIGIN =
  process.env.NEXT_PUBLIC_CLOUD_ORIGIN ?? "https://business-helper-ten.vercel.app";

export const CLOUD_REQUEST_TIMEOUT_MS = 10_000;

export interface CloudProvisionResult {
  ok: boolean;
  alreadyProvisioned?: boolean;
  organization_id?: string;
  needsOnboarding?: boolean;
}

export interface CloudStaffLoginResult {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  locked?: boolean;
  retryAfterSeconds?: number;
}

function cloudUrl(path: string): string {
  return isDesktopApp() ? `${CLOUD_ORIGIN}${path}` : path;
}

/**
 * Call a CLOUD route with a timeout. The caller supplies the full
 * RequestInit (including the Authorization Bearer header); the response is
 * returned unparsed so the caller decides how to read errors.
 */
export async function callCloudEndpoint(
  path: string,
  init: RequestInit,
  timeoutMs: number = CLOUD_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(cloudUrl(path), { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Cloud request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provision the signed-in user's workspace (org + profile + org claim) on
 * the cloud endpoint. Throws with the server's error message (and
 * `status`/`code` attached) when the endpoint answers non-OK, so callers
 * surface the real reason instead of a generic failure.
 */
export async function provisionViaCloud(input: {
  accessToken: string;
  organizationName?: string;
}): Promise<CloudProvisionResult> {
  const res = await callCloudEndpoint("/api/auth/provision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify(
      input.organizationName ? { organization_name: input.organizationName } : {},
    ),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const message =
      typeof body.error === "string" && body.error
        ? body.error
        : `Workspace provisioning failed (HTTP ${res.status})`;
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = res.status;
    if (typeof body.code === "string") error.code = body.code;
    throw error;
  }

  return (await res.json()) as CloudProvisionResult;
}

/**
 * Staff Profile-ID login on the cloud endpoint (HYBRID Slice 2).
 *
 * The login itself carries no Bearer token — the Profile ID + password ARE
 * the credential — so this posts them to the Vercel endpoint, which checks
 * them server-side (with the brute-force lockout) and returns Supabase
 * session tokens for setSession. The server answers the same generic
 * error for an unknown ID and a wrong password; a locked identifier
 * answers 429 with locked: true, and that body is returned as-is so the
 * caller can surface the wait time. Network/timeout errors throw, like
 * provisionViaCloud.
 */
export async function staffLoginViaCloud(input: {
  loginId: string;
  password: string;
}): Promise<CloudStaffLoginResult> {
  const res = await callCloudEndpoint("/api/identity/staff/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: input.loginId, password: input.password }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: res.ok && body.ok === true,
    accessToken: typeof body.accessToken === "string" ? body.accessToken : undefined,
    refreshToken: typeof body.refreshToken === "string" ? body.refreshToken : undefined,
    error:
      typeof body.error === "string" && body.error
        ? body.error
        : res.ok
          ? undefined
          : `Staff sign-in failed (HTTP ${res.status})`,
    locked: body.locked === true,
    retryAfterSeconds: typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined,
  };
}

/**
 * Current staff member + permissions on the cloud endpoint (HYBRID Slice 2).
 *
 * Drop-in replacement for `authorizedFetch("/api/identity/staff/me")`:
 * same Response shape, same Bearer handling (session token with the
 * restore/refresh tolerance), but on desktop the request goes to the
 * Vercel endpoint instead of the local server, which has no service key
 * and would 500. The server verifies the Bearer itself (resolveActor)
 * and returns the profile/employee/organization/permissions row; org and
 * user come from the token, never from the request.
 */
export async function fetchStaffMe(): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return callCloudEndpoint("/api/identity/staff/me", { headers });
}

/**
 * Purchase submit on the cloud endpoint (HYBRID Slice 4 — the B1 fix).
 *
 * `fetch`-shaped so the purchase sync engine can use it as its default
 * fetch on desktop: same URL + init the caller passes, but the request
 * goes to the Vercel endpoint with the user's Bearer token instead of
 * the local standalone server, which has no service key and would 500
 * on `POST /api/purchases`. The server verifies the Bearer itself
 * (`resolveActor` via `requirePermission`) and the `create_purchase_atomic`
 * RPC stays service-role-only server-side — the desktop never calls the
 * RPC directly. On the web build `callCloudEndpoint` keeps the relative
 * path, so this is identical to `authorizedFetch` there.
 */
export async function purchaseCloudFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return callCloudEndpoint(input, { ...init, headers });
}
