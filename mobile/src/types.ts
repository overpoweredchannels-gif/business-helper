export interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

export interface LocationSample {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  capturedAt: string;
}

export interface QueuedLocation {
  dutySessionId: string;
  scheduledEndAt?: string | null;
  point: LocationSample;
}

export interface DutyStatus {
  onDuty: boolean;
  dutySessionId: string | null;
  startedAt: string | null;
  scheduledEndAt: string | null;
  timezone: string;
  deviceStatus?: string | null;
  lastLocationAt?: string | null;
  lastEndedAt?: string | null;
  lastEndedReason?: string | null;
  message?: string | null;
}

export interface StaffIdentity {
  employeeName: string;
  organizationName: string;
  dutyStart: string;
  dutyEnd: string;
}

export interface OwnerIdentity {
  displayName: string;
  role: string;
}
