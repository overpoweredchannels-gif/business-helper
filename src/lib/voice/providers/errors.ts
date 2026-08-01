export type ProviderErrorCode =
  | "INITIALIZATION_FAILED"
  | "AUTHENTICATION_FAILED"
  | "CONNECTION_FAILED"
  | "CONNECTION_LOST"
  | "TIMEOUT"
  | "INVALID_CONFIGURATION"
  | "INVALID_AUDIO"
  | "UNSUPPORTED_LANGUAGE"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
}
