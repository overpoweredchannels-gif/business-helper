export type {
  Provider,
  SpeechToTextProvider,
  TextToSpeechProvider,
  RealtimeTransportProvider,
  ProviderState,
  ProviderHealth,
  ProviderCapabilities,
  ProviderConfiguration,
  RetryPolicy,
  VoiceSession,
  AudioChunk,
  SpeechRequest,
  AudioStream,
  TransportMessage,
  ProviderEventDataMap,
  ProviderEventName,
  ProviderEvent,
  ProviderEventHandler,
  ProviderErrorCode,
  ProviderError,
} from "./providers";

export {
  ProviderLifecycleEvents,
  ProviderHealthEvents,
  SttEvents,
  TtsEvents,
  TransportEvents,
  ProviderErrorEvents,
} from "./providers";

export type {
  SpeechRuntime,
  AudioInputModule,
  AudioProcessingModule,
  VoiceActivityDetectionModule,
  SpeechRecognitionModule,
  SpeechSynthesisModule,
  AudioOutputModule,
  RuntimeMonitoringModule,
} from "./speech";

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
  SpeechEventDataMap,
  SpeechEventName,
  SpeechEvent,
  SpeechEventHandler,
  SpeechRuntimeErrorCode,
  SpeechRuntimeError,
} from "./speech";

export {
  SpeechLifecycleEvents,
  AudioInputEvents,
  RecognitionEvents,
  PlaybackEvents,
  ProviderEvents,
  MonitoringEvents,
  ErrorEvents,
} from "./speech";

export {
  SpeechRuntimeEventNames,
  StreamingRuntimeEventNames,
  DialogueRuntimeEventNames,
  ProviderRuntimeEventNames,
  SessionRuntimeEventNames,
  SdkRuntimeEventNames,
  TelemetryRuntimeEventNames,
} from "./events";
export type {
  RuntimeEventCategory,
  RuntimeEventDataMap,
  RuntimeEventName,
  VoiceRuntimeEvent,
  VoiceRuntimeEventHandler,
} from "./events";

export { TypedEventEmitter } from "./event-emitter";
export type { EventSubscription } from "./event-emitter";

export { telemetry, voiceEvents } from "./telemetry";
export type { LogLevel, LogEntry, MetricSnapshot, SpanRecord, TelemetrySnapshot } from "./telemetry";

export { VoiceSDK, VoiceSDKSession } from "./sdk";
export type { VoiceSdkConfiguration, VoiceSdkSessionOptions, VoiceSdkSessionStats, SendTextResult } from "./sdk";

export { SpeechRuntimeImpl, generateSessionId } from "./runtime/speech-runtime";
export { StreamingRuntime } from "./runtime/streaming-runtime";
export type { UtteranceResult, UtteranceHandler, StreamingRuntimeOptions } from "./runtime/streaming-runtime";
export { DialogueRuntime } from "./runtime/dialogue-runtime";
export type {
  TurnRecord,
  ClarificationRecord,
  ConfirmationRecord,
  DialogueRuntimeOptions,
  TurnWork,
} from "./runtime/dialogue-runtime";
export { VoiceGatewayClient, VOICE_CHANNEL } from "./runtime/gateway-client";
export type { GatewaySendInput, GatewaySendResult, GatewayStreamResult } from "./runtime/gateway-client";
export { SessionRuntime } from "./runtime/session-runtime";
export type {
  VoiceSessionState,
  VoiceSessionRecord,
  SessionRuntimeOptions,
  SessionRecoveryOptions,
} from "./runtime/session-runtime";

export { ProviderRegistry, providerRegistry } from "./providers/registry";
export type { ProviderKind, ProviderRegistryOptions, ProviderRegistration } from "./providers/registry";
export { SimulatedSttProvider } from "./providers/simulated-stt";
export { SimulatedTtsProvider } from "./providers/simulated-tts";
export { WebSpeechSttProvider } from "./providers/web-speech-stt";
export { WebSpeechTtsProvider } from "./providers/web-speech-tts";
export { BaseProvider, DEFAULT_RETRY_POLICY, makeProviderError, isRetryableError, sleep } from "./providers/base";
export { createAudioChunk, createSilenceChunk, computeEnergy, cloneChunk, validateAudioFormat } from "./providers/audio";
