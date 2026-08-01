export type SpeechRuntimeErrorCode =
  | "AudioDeviceUnavailable"
  | "AudioPermissionDenied"
  | "InvalidAudioFormat"
  | "RecognitionFailure"
  | "SynthesisFailure"
  | "PlaybackFailure"
  | "ProviderUnavailable"
  | "RuntimeInitializationFailed"
  | "RuntimeStateViolation"
  | "ConfigurationError";

export interface SpeechRuntimeError {
  code: SpeechRuntimeErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
}
