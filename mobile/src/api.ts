import { clearSession, getSession, saveSession } from "./storage";
import type { DutyStatus, LocationSample, StaffIdentity, StoredSession } from "./types";

const API_URL = (process.env.EXPO_PUBLIC_TRADEOS_API_URL ?? "").replace(/\/$/, "");
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

interface StaffMeResponse {
  me?: {
    employee?: { full_name?: string | null } | null;
    profile?: { display_name?: string | null } | null;
    organization?: {
      name?: string | null;
      working_hours?: { duty_start?: string | null; duty_end?: string | null } | null;
    } | null;
  };
}

interface DutyStatusResponse {
  onDuty?: boolean;
  dutySessionId?: string | null;
  startedAt?: string | null;
}

interface StartDutyResponse {
  dutySessionId?: string | null;
}

function requireConfiguration(): void {
  if (!API_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Mobile environment is incomplete. Configure the TradeOS API URL and Supabase public settings.");
  }
}

export async function login(loginId: string, password: string): Promise<void> {
  requireConfiguration();
  const response = await fetch(`${API_URL}/api/identity/staff/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: loginId.trim(), password }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok || !data.accessToken || !data.refreshToken) {
    throw new Error(data.error ?? "Sign in failed.");
  }
  await saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
}

async function refreshSession(refreshToken: string): Promise<StoredSession> {
  requireConfiguration();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token || !data.refresh_token) {
    await clearSession();
    throw new Error("Your TradeOS session expired. Open the app and sign in again.");
  }
  const session = { accessToken: String(data.access_token), refreshToken: String(data.refresh_token) };
  await saveSession(session);
  return session;
}

export async function apiFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  requireConfiguration();
  let session = await getSession();
  if (!session) throw new Error("Sign in is required.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status !== 401 || !retry) return response;
  session = await refreshSession(session.refreshToken);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

async function jsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error ?? data.message ?? "TradeOS request failed.");
  return data as T;
}

export async function loadStaffIdentity(): Promise<StaffIdentity> {
  const data = await jsonRequest<StaffMeResponse>("/api/identity/staff/me");
  return {
    employeeName: data.me?.employee?.full_name ?? data.me?.profile?.display_name ?? "Employee",
    organizationName: data.me?.organization?.name ?? "TradeOS",
    dutyStart: data.me?.organization?.working_hours?.duty_start ?? "08:00",
    dutyEnd: data.me?.organization?.working_hours?.duty_end ?? "16:00",
  };
}

export async function getDutyStatus(): Promise<DutyStatus> {
  const data = await jsonRequest<DutyStatusResponse>("/api/location/device-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status" }),
  });
  return { onDuty: Boolean(data.onDuty), dutySessionId: data.dutySessionId ?? null, startedAt: data.startedAt ?? null };
}

export async function startDuty(point: LocationSample): Promise<string> {
  const data = await jsonRequest<StartDutyResponse>("/api/location/device-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "start",
      deviceName: "TradeOS Workforce mobile app",
      startLatitude: point.latitude,
      startLongitude: point.longitude,
      startAccuracy: point.accuracy,
    }),
  });
  if (!data.dutySessionId) throw new Error("TradeOS did not return a duty session.");
  return String(data.dutySessionId);
}

export async function stopDuty(): Promise<void> {
  await jsonRequest("/api/location/device-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "signout" }),
  });
}

export async function uploadLocation(sessionId: string, point: LocationSample): Promise<void> {
  await jsonRequest("/api/location/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dutySessionId: sessionId, ...point }),
  });
}

export async function revokeServerSession(): Promise<void> {
  const session = await getSession();
  if (!session || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.accessToken}` },
  }).catch(() => undefined);
}
