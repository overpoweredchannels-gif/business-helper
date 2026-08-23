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

export interface DutyStatus {
  onDuty: boolean;
  dutySessionId: string | null;
  startedAt: string | null;
}

export interface StaffIdentity {
  employeeName: string;
  organizationName: string;
  dutyStart: string;
  dutyEnd: string;
}
