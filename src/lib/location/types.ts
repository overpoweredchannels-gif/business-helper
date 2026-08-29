import type { TrackingStatus } from "./tracking-status";

export interface LocationUploadRequest {
  organizationId: string;
  profileId: string;
  dutySessionId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  capturedAt: string;
  battery?: number | null;
}

export interface LocationUploadResponse {
  ok: boolean;
  error?: string;
  pointId?: string;
}

export interface CurrentLocationView {
  profileId: string;
  employeeName: string;
  role: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  capturedAt: string;
  isOnDuty: boolean;
  dutySessionId: string | null;
  scheduledEndAt: string | null;
  deviceStatus: string | null;
  trackingStatus: TrackingStatus;
  trackingStatusLabel: string;
  trackingError: string | null;
  assignedArea: string | null;
  lastUpdateAge: number;
  hasLocation: boolean;
}

export interface DeviceSessionRequest {
  action: "register" | "signout" | "status" | "start" | "health";
  organizationId: string;
  profileId: string;
  deviceToken?: string;
  deviceName?: string;
}

export interface DeviceSessionResponse {
  ok: boolean;
  error?: string;
  sessionId?: string;
  dutySessionId?: string;
  expiresAt?: string;
}

export interface LocationQueryResult {
  ok: boolean;
  message: string;
  error?: string;
}

export interface OfflineLocationPoint {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  capturedAt: string;
  battery: number | null;
  retryCount: number;
}
