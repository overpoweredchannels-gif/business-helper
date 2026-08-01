import type { SpeechRecognitionModule } from "../speech/contracts";
import type { AudioChunk, SpeechToTextProvider, VoiceSession } from "../providers";
import { voiceEvents } from "../telemetry";
import { SpeechRuntimeEventNames as Emit } from "../events";

export interface TranscriptStateProvider extends SpeechToTextProvider {
  getLastPartialText(): string;
  getFinalTranscript(): string | null;
}

export type ProviderResolver = (providerId: string) => Promise<SpeechToTextProvider>;

/**
 * SpeechRecognitionModule implementation. Wraps the active STT provider and
 * forwards audio. After every writeAudio() it reads the provider's transcript
 * state (deterministic for simulated providers) and emits
 * speech.stt_partial / speech.stt_final events exactly once per change.
 */
export class SpeechRecognitionModuleImpl implements SpeechRecognitionModule {
  private provider: SpeechToTextProvider | null = null;
  private providerId: string | null = null;
  private sessionId: string | null = null;
  private lastEmittedPartial = "";
  private finalEmitted = false;
  private partialCount = 0;
  private finalCount = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private resolveProvider: ProviderResolver,
    private pollIntervalMs = 15,
  ) {}

  async initialize(providerId: string): Promise<void> {
    this.providerId = providerId;
  }

  isInitialized(): boolean {
    return this.providerId !== null;
  }

  async startRecognition(session: VoiceSession): Promise<void> {
    const provider = await this.resolveProvider(this.providerId ?? "stt.simulated");
    await provider.startRecognition(session);
    this.provider = provider;
    this.sessionId = session.id;
    this.lastEmittedPartial = "";
    this.finalEmitted = false;
    if (this.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => this.emitTranscriptState(), this.pollIntervalMs);
    }
  }

  async stopRecognition(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    const provider = this.provider;
    this.provider = null;
    if (provider) {
      await provider.stopRecognition();
    }
    this.sessionId = null;
  }

  async writeAudio(audio: AudioChunk): Promise<void> {
    await this.provider?.writeAudio(audio);
    this.emitTranscriptState();
  }

  getProvider(): SpeechToTextProvider | null {
    return this.provider;
  }

  getPartialCount(): number {
    return this.partialCount;
  }

  getFinalCount(): number {
    return this.finalCount;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  private emitTranscriptState(): void {
    const provider = this.provider as TranscriptStateProvider | null;
    if (!provider) return;
    const partial = typeof provider.getLastPartialText === "function" ? provider.getLastPartialText() : "";
    if (partial && partial !== this.lastEmittedPartial) {
      this.lastEmittedPartial = partial;
      this.partialCount++;
      voiceEvents.emit("speech", Emit.STT_PARTIAL, { text: partial, confidence: 0.9 }, this.sessionId ?? undefined);
    }
    const final = typeof provider.getFinalTranscript === "function" ? provider.getFinalTranscript() : null;
    if (final && !this.finalEmitted) {
      this.finalEmitted = true;
      this.finalCount++;
      voiceEvents.emit("speech", Emit.STT_FINAL, { text: final, confidence: 0.95 }, this.sessionId ?? undefined);
    }
  }
}
