export type SpeechRuntimeState =
  | "created"
  | "initialized"
  | "idle"
  | "listening"
  | "recognizing"
  | "speaking"
  | "stopped"
  | "disposed"
  | "failed";

export type AudioInputState = "closed" | "opened" | "capturing" | "failed";

export type AudioOutputState = "closed" | "opened" | "playing" | "paused" | "failed";

export type VadState = "idle" | "detecting" | "speech" | "silence" | "failed";

export interface AudioDeviceDescriptor {
  deviceId: string;
  label?: string;
  groupId?: string;
  kind: "audioinput" | "audiooutput";
}

export interface VadConfiguration {
  mode?: "aggressive" | "moderate" | "sensitive";
  silenceTimeoutMs: number;
  speechThreshold?: number;
  silenceThreshold?: number;
  minSpeechDurationMs?: number;
}

export interface VadResult {
  speechDetected: boolean;
  energy: number;
  timestamp: number;
}

export interface RuntimeHealth {
  healthy: boolean;
  sttConnected: boolean;
  ttsConnected: boolean;
  audioInputActive: boolean;
  audioOutputActive: boolean;
  uptimeMs: number;
  lastError?: string;
}

export interface SpeechRuntimeConfiguration {
  sttProviderId: string;
  ttsProviderId: string;
  audioInputDevice: AudioDeviceDescriptor;
  audioOutputDevice: AudioDeviceDescriptor;
  inputSampleRate: number;
  outputSampleRate: number;
  audioEncoding: string;
  vad: VadConfiguration;
  silenceTimeoutMs: number;
  recognitionTimeoutMs: number;
  playbackBufferSize: number;

  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  automaticGainControl?: boolean;
  preferredLanguage?: string;
  preferredVoice?: string;
  maxPlaybackDurationMs?: number;
  logLevel?: string;
}
