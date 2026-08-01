import type { SpeechRequest, AudioChunk, VoiceSession, AudioStream } from "../providers";
import type {
  AudioDeviceDescriptor,
  AudioInputState,
  AudioOutputState,
  RuntimeHealth,
  SpeechRuntimeConfiguration,
  SpeechRuntimeState,
  VadResult,
  VadState,
} from "./types";

// ─── Public Runtime Interface ─────────────────────────────────────────────────

export interface SpeechRuntime {
  initialize(config: SpeechRuntimeConfiguration): Promise<void>;

  start(): Promise<void>;

  stop(): Promise<void>;

  dispose(): Promise<void>;

  startListening(): Promise<void>;

  stopListening(): Promise<void>;

  speak(request: SpeechRequest): Promise<void>;

  interruptPlayback(): Promise<void>;

  getState(): SpeechRuntimeState;
}

// ─── Internal Module Interfaces ────────────────────────────────────────────────

export interface AudioInputModule {
  open(device: AudioDeviceDescriptor): Promise<void>;
  close(): Promise<void>;
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  getState(): AudioInputState;
}

export interface AudioProcessingModule {
  normalize(audio: AudioChunk): Promise<AudioChunk>;
  suppressNoise(audio: AudioChunk): Promise<AudioChunk>;
  cancelEcho(audio: AudioChunk): Promise<AudioChunk>;
  validateFormat(audio: AudioChunk): boolean;
}

export interface VoiceActivityDetectionModule {
  start(): Promise<void>;
  stop(): Promise<void>;
  processAudio(audio: AudioChunk): Promise<VadResult>;
  getState(): VadState;
}

export interface SpeechRecognitionModule {
  initialize(providerId: string): Promise<void>;
  startRecognition(session: VoiceSession): Promise<void>;
  stopRecognition(): Promise<void>;
  writeAudio(audio: AudioChunk): Promise<void>;
}

export interface SpeechSynthesisModule {
  initialize(providerId: string): Promise<void>;
  synthesize(request: SpeechRequest): Promise<AudioStream>;
  stopSynthesis(): Promise<void>;
}

export interface AudioOutputModule {
  open(device: AudioDeviceDescriptor): Promise<void>;
  close(): Promise<void>;
  play(stream: AudioStream): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  getState(): AudioOutputState;
}

export interface RuntimeMonitoringModule {
  start(): Promise<void>;
  stop(): Promise<void>;
  reportHealth(): Promise<RuntimeHealth>;
}
