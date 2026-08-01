export type { SpeechRuntime } from "./contracts";
export type { AudioInputModule, AudioProcessingModule, VoiceActivityDetectionModule } from "./contracts";
export type { SpeechRecognitionModule, SpeechSynthesisModule, AudioOutputModule, RuntimeMonitoringModule } from "./contracts";

export type {
  SpeechRuntimeState,
  AudioInputState,
  AudioOutputState,
  VadState,
  AudioDeviceDescriptor,
  VadConfiguration,
  VadResult,
  RuntimeHealth,
  SpeechRuntimeConfiguration,
} from "./types";

export { SpeechLifecycleEvents, AudioInputEvents, RecognitionEvents, PlaybackEvents } from "./events";
export { ProviderEvents, MonitoringEvents, ErrorEvents } from "./events";
export type {
  SpeechEventDataMap,
  SpeechEventName,
  SpeechEvent,
  SpeechEventHandler,
} from "./events";

export type { SpeechRuntimeErrorCode, SpeechRuntimeError } from "./errors";
