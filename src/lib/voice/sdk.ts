import type { AudioChunk } from "./providers/types";
import type { SpeechRequest } from "./providers";
import type { SpeechRuntimeConfiguration } from "./speech/types";
import { SpeechRuntimeImpl } from "./runtime/speech-runtime";
import { StreamingRuntime, type UtteranceHandler } from "./runtime/streaming-runtime";
import { DialogueRuntime } from "./runtime/dialogue-runtime";
import { VoiceGatewayClient } from "./runtime/gateway-client";
import { SessionRuntime, type VoiceSessionRecord } from "./runtime/session-runtime";
import { telemetry, voiceEvents, type TelemetrySnapshot } from "./telemetry";
import { TypedEventEmitter, type EventSubscription } from "./event-emitter";
import type {
  RuntimeEventCategory,
  RuntimeEventName,
  VoiceRuntimeEvent,
  VoiceRuntimeEventHandler,
} from "./events";
import { SdkRuntimeEventNames as Emit } from "./events";

export interface VoiceSdkConfiguration {
  sttProviderId?: string;
  ttsProviderId?: string;
  language?: string;
  voice?: string;
  inputSampleRate?: number;
  outputSampleRate?: number;
  silenceTimeoutMs?: number;
  recognitionTimeoutMs?: number;
  turnTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxSessions?: number;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  automaticGainControl?: boolean;
  gatewayClient?: VoiceGatewayClient;
}

export interface VoiceSdkSessionOptions {
  userId?: string | null;
  conversationId?: string | null;
}

export interface VoiceSdkSessionStats {
  sessionId: string;
  state: string;
  speechState: string;
  partials: number;
  finals: number;
  responses: number;
  latency: Record<string, { samples: number; avgMs: number; minMs: number; maxMs: number }>;
}

export interface SendTextResult {
  ok: boolean;
  text: string;
  conversationId: string;
}

/**
 * Public Voice SDK. Exposes session management, microphone streaming,
 * text chat through the Conversation Gateway, TTS playback, interruptions,
 * event subscription and telemetry. The SDK wires the Speech, Streaming,
 * Dialogue, Session and Gateway layers together.
 */
export class VoiceSDK {
  readonly sdkId: string;
  readonly config: VoiceSdkConfiguration;
  readonly gateway: VoiceGatewayClient;
  readonly speech: SpeechRuntimeImpl;
  readonly streaming: StreamingRuntime;
  readonly dialogue: DialogueRuntime;
  readonly sessions: SessionRuntime;
  private created = false;

  constructor(config: VoiceSdkConfiguration = {}) {
    this.sdkId = `sdk_${Date.now()}`;
    this.config = config;
    this.gateway = config.gatewayClient ?? new VoiceGatewayClient();
    this.speech = new SpeechRuntimeImpl();
    this.streaming = new StreamingRuntime({
      stt: undefined,
      session: { id: `sdk_stream_${Date.now()}`, language: config.language ?? "en-US", sampleRate: config.inputSampleRate ?? 16000 },
    });
    this.dialogue = new DialogueRuntime({ turnTimeoutMs: config.turnTimeoutMs ?? 30000 });
    this.sessions = new SessionRuntime({
      idleTimeoutMs: config.idleTimeoutMs ?? 60000,
      maxSessions: config.maxSessions ?? 10,
      gatewayClient: this.gateway,
    });
    voiceEvents.emit("sdk", Emit.CREATED, { sdkId: this.sdkId });
  }

  buildSpeechConfiguration(): SpeechRuntimeConfiguration {
    return {
      sttProviderId: this.config.sttProviderId ?? "stt.simulated",
      ttsProviderId: this.config.ttsProviderId ?? "tts.simulated",
      audioInputDevice: { deviceId: "simulated-mic", kind: "audioinput", label: "Simulated Microphone" },
      audioOutputDevice: { deviceId: "simulated-speaker", kind: "audiooutput", label: "Simulated Speaker" },
      inputSampleRate: this.config.inputSampleRate ?? 16000,
      outputSampleRate: this.config.outputSampleRate ?? 16000,
      audioEncoding: "pcm_s16le",
      vad: { mode: "moderate", silenceTimeoutMs: this.config.silenceTimeoutMs ?? 600 },
      silenceTimeoutMs: this.config.silenceTimeoutMs ?? 600,
      recognitionTimeoutMs: this.config.recognitionTimeoutMs ?? 30000,
      playbackBufferSize: 8,
      noiseSuppression: this.config.noiseSuppression ?? true,
      echoCancellation: this.config.echoCancellation ?? true,
      automaticGainControl: this.config.automaticGainControl ?? true,
      preferredLanguage: this.config.language ?? "en-US",
      preferredVoice: this.config.voice,
    };
  }

  async start(): Promise<void> {
    if (this.created) return;
    await this.speech.initialize(this.buildSpeechConfiguration());
    await this.speech.start();
    this.streaming.setUtteranceHandler(this.buildUtteranceHandler());
    await this.streaming.start();
    this.sessions.startMonitoring();
    this.created = true;
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.listSessions()) {
      if (session.state !== "ended") {
        await this.endSession(session.sessionId);
      }
    }
    this.sessions.stopMonitoring();
    await this.streaming.stop();
    await this.speech.dispose();
    this.created = false;
    telemetry.info("sdk", "VoiceSDK shut down.");
  }

  private buildUtteranceHandler(): UtteranceHandler {
    return async (transcript) => {
      const session = this.activeSession();
      const sessionId = session?.sessionId ?? "sdk";
      const started = Date.now();
      const result = await this.gateway.sendMessage({
        sessionId,
        conversationId: session?.conversationId ?? undefined,
        userId: session?.userId ?? undefined,
        message: transcript,
      });
      const durationMs = Date.now() - started;
      if (session) {
        this.sessions.touchSession(session.sessionId);
        if (result.conversationId) {
          this.sessions.setConversation(session.sessionId, result.conversationId);
        }
      }
      const parts = result.ok ? [result.text] : [];
      if (result.ok && result.text) {
        await this.speech.speak({ text: result.text, voice: this.config.voice, language: this.config.language });
      }
      return {
        ok: result.ok,
        text: result.ok ? result.text : result.error ?? "",
        parts,
        durationMs,
      };
    };
  }

  private activeSession(): VoiceSessionRecord | null {
    const active = this.sessions.listSessions().find((s) => s.state === "active");
    return active ?? null;
  }

  async createSession(options: VoiceSdkSessionOptions = {}): Promise<VoiceSDKSession> {
    const record = this.sessions.createSession(options.userId ?? null, options.conversationId ?? null);
    const session = new VoiceSDKSession(this, record);
    this.sessions.startSession(record.sessionId);
    return session;
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.getSession(sessionId);
    if (session && session.state !== "ended") {
      this.sessions.endSession(sessionId);
    }
  }

  // ─── Event subscription ─────────────────────────────────────────────────────

  on(event: RuntimeEventName, handler: VoiceRuntimeEventHandler): EventSubscription {
    return voiceEvents.on(event, handler);
  }

  onCategory(category: RuntimeEventCategory, handler: VoiceRuntimeEventHandler): EventSubscription {
    return voiceEvents.onCategory(category, handler);
  }

  onAny(handler: VoiceRuntimeEventHandler): EventSubscription {
    return voiceEvents.onAny(handler);
  }

  // ─── Telemetry ──────────────────────────────────────────────────────────────

  getTelemetry(): TelemetrySnapshot {
    return telemetry.snapshot();
  }

  getLatencyStats(phase: string): { samples: number; avgMs: number; minMs: number; maxMs: number } {
    return telemetry.getLatencyStats(phase);
  }

  getEmitter(): TypedEventEmitter {
    return voiceEvents;
  }
}

/**
 * A live voice session: start/stop microphone streaming, send text, speak,
 * interrupt, and observe session-scoped events.
 */
export class VoiceSDKSession {
  readonly id: string;
  private endedFlag = false;
  private responses = 0;
  private sessionEventSubscription: EventSubscription | null = null;

  constructor(
    private sdk: VoiceSDK,
    private record: VoiceSessionRecord,
  ) {
    this.id = record.sessionId;
    this.sessionEventSubscription = voiceEvents.onAny((event: VoiceRuntimeEvent) => {
      if (event.sessionId && event.sessionId !== this.id) return;
      if (event.name === "speech.stt_final" && event.sessionId === this.id) {
        const text = (event.data as { text: string }).text;
        if (this.sdk.streaming) {
          void this.sdk.streaming.handleUtterance(text).then((result) => {
            if (result && result.ok) {
              this.responses++;
              void sdk.sessions.touchSession(this.id);
            }
          });
        }
      }
    });
  }

  getState(): string {
    return this.record.state;
  }

  getSpeechState(): string {
    return this.sdk.speech.getState();
  }

  getConversationId(): string | null {
    return this.record.conversationId;
  }

  /** Starts the microphone pipeline (simulated in Node). */
  async startListening(transcript?: string): Promise<void> {
    this.assertActive();
    if (transcript !== undefined) {
      this.sdk.speech.setMockTranscript(transcript);
    }
    await this.sdk.speech.startListening(this.id);
    this.sdk.sessions.touchSession(this.id);
  }

  async stopListening(): Promise<void> {
    await this.sdk.speech.stopListening();
  }

  /** Injects simulated microphone audio into the speech pipeline. */
  async sendAudio(chunk: AudioChunk): Promise<void> {
    this.assertActive();
    voiceEvents.emit("sdk", Emit.AUDIO_RECEIVED, { sessionId: this.id, bytes: chunk.data.byteLength }, this.id);
    await this.sdk.speech.injectAudio(chunk);
  }

  /** Sends a text message through the Conversation Gateway and speaks the reply. */
  async sendText(message: string): Promise<SendTextResult> {
    this.assertActive();
    this.sdk.sessions.touchSession(this.id);
    const result = await this.sdk.gateway.sendMessage({
      sessionId: this.id,
      conversationId: this.record.conversationId ?? undefined,
      userId: this.record.userId ?? undefined,
      message,
    });
    if (result.conversationId) {
      this.sdk.sessions.setConversation(this.id, result.conversationId);
    }
    if (result.ok && result.text) {
      await this.sdk.speech.speak({ text: result.text, voice: this.sdk.config.voice, language: this.sdk.config.language });
      this.responses++;
    }
    return { ok: result.ok, text: result.text, conversationId: result.conversationId };
  }

  async speak(text: string, voice?: string): Promise<void> {
    this.assertActive();
    await this.sdk.speech.speak({ text, voice: voice ?? this.sdk.config.voice, language: this.sdk.config.language } as SpeechRequest);
  }

  async interrupt(): Promise<void> {
    await this.sdk.speech.interruptPlayback();
    if (this.sdk.dialogue.getCurrentTurnId()) {
      await this.sdk.dialogue.interrupt();
    }
  }

  getResponsesCount(): number {
    return this.responses;
  }

  async end(): Promise<void> {
    if (this.endedFlag) return;
    this.endedFlag = true;
    await this.sdk.speech.stopListening();
    this.sdk.sessions.endSession(this.id);
    this.sessionEventSubscription?.unsubscribe();
    voiceEvents.emit("sdk", Emit.SESSION_ENDED, { sessionId: this.id }, this.id);
  }

  getStats(): VoiceSdkSessionStats {
    return {
      sessionId: this.id,
      state: this.record.state,
      speechState: this.sdk.speech.getState(),
      partials: this.sdk.speech.getPartialCount(),
      finals: this.sdk.speech.getFinalCount(),
      responses: this.responses,
      latency: {
        stt: this.sdk.getLatencyStats("stt"),
        gateway: this.sdk.getLatencyStats("gateway"),
      },
    };
  }

  private assertActive(): void {
    if (this.endedFlag || this.record.state === "ended") {
      throw new Error(`Session ${this.id} has ended.`);
    }
  }
}
