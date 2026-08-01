import type {
  ProviderCapabilities,
  ProviderConfiguration,
  ProviderHealth,
  ProviderState,
  VoiceSession,
  AudioChunk,
  SpeechRequest,
  AudioStream,
  TransportMessage,
} from "./types";

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: ProviderCapabilities;

  initialize(config: ProviderConfiguration): Promise<void>;

  start(): Promise<void>;

  stop(): Promise<void>;

  dispose(): Promise<void>;

  health(): Promise<ProviderHealth>;

  getState(): ProviderState;
}

export interface SpeechToTextProvider extends Provider {
  startRecognition(session: VoiceSession): Promise<void>;

  stopRecognition(): Promise<void>;

  writeAudio(chunk: AudioChunk): Promise<void>;
}

export interface TextToSpeechProvider extends Provider {
  synthesize(request: SpeechRequest): Promise<AudioStream>;

  stopSynthesis(): Promise<void>;
}

export interface RealtimeTransportProvider extends Provider {
  connect(session: VoiceSession): Promise<void>;

  disconnect(): Promise<void>;

  send(message: TransportMessage): Promise<void>;
}
