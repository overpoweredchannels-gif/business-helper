import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { LocationSample, StoredSession } from "./types";

export type AccountMode = "employee" | "owner";

export interface QueuedLocation {
  dutySessionId: string;
  scheduledEndAt?: string | null;
  point: LocationSample;
}

const ACCESS_TOKEN_KEY = "tradeos_access_token";
const REFRESH_TOKEN_KEY = "tradeos_refresh_token";
const ACCOUNT_MODE_KEY = "tradeos_account_mode";
const DUTY_SESSION_KEY = "tradeos_duty_session_id";
const DUTY_SCHEDULED_END_KEY = "tradeos_duty_scheduled_end_at";
const CONSENT_KEY = "tradeos_location_consent";
const LOCATION_QUEUE_KEY = "tradeos_location_queue";
const MAX_QUEUED_POINTS = 2000;

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken),
  ]);
}

export async function getSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(ACCOUNT_MODE_KEY),
    SecureStore.deleteItemAsync(DUTY_SESSION_KEY),
    SecureStore.deleteItemAsync(DUTY_SCHEDULED_END_KEY),
  ]);
}

export const saveAccountMode = (mode: AccountMode) => SecureStore.setItemAsync(ACCOUNT_MODE_KEY, mode);
export async function getAccountMode(): Promise<AccountMode | null> {
  const mode = await SecureStore.getItemAsync(ACCOUNT_MODE_KEY);
  return mode === "owner" || mode === "employee" ? mode : null;
}

export const saveDutySessionId = (sessionId: string) => SecureStore.setItemAsync(DUTY_SESSION_KEY, sessionId);
export const getDutySessionId = () => SecureStore.getItemAsync(DUTY_SESSION_KEY);
export const saveDutyScheduledEndAt = (scheduledEndAt: string) => SecureStore.setItemAsync(DUTY_SCHEDULED_END_KEY, scheduledEndAt);
export const getDutyScheduledEndAt = () => SecureStore.getItemAsync(DUTY_SCHEDULED_END_KEY);
export const clearDutySessionId = () => Promise.all([
  SecureStore.deleteItemAsync(DUTY_SESSION_KEY),
  SecureStore.deleteItemAsync(DUTY_SCHEDULED_END_KEY),
]).then(() => undefined);

export async function setLocationConsent(consented: boolean): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, consented ? "yes" : "no");
}

export async function hasLocationConsent(): Promise<boolean> {
  return (await AsyncStorage.getItem(CONSENT_KEY)) === "yes";
}

export async function getQueuedLocations(): Promise<QueuedLocation[]> {
  const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveQueuedLocations(points: QueuedLocation[]): Promise<void> {
  await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(points.slice(-MAX_QUEUED_POINTS)));
}

export async function clearQueuedLocations(): Promise<void> {
  await AsyncStorage.removeItem(LOCATION_QUEUE_KEY);
}
