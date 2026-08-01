import { BaseProvider, makeProviderError, sleep } from "./base";
import type { SpeechToTextProvider } from "./contracts";
import type { AudioChunk, VoiceSession } from "./types";
import { computeEnergy } from "./audio";
import { telemetry } from "../telemetry";
import { ProviderRuntimeEventNames as Emit } from "../events";

export interface SimulatedSttOptions {
  partialsPerUtterance?: number;
  chunkDurationMs?: number;
  utteranceGapMs?: number;
  finalizeOnSilence?: boolean;
}

/**
 * In-process streaming STT provider used for development and validation.
 * Implements the full SpeechToTextProvider contract: streaming audio in,
 * partial transcripts, final transcripts, reconnect, health.
 *
 * Progress is driven synchronously by writeAudio(): after each chunk the
 * provider updates its partial/final state, so callers can read the state
 * and forward events deterministically.
 */
export class SimulatedSttProvider extends BaseProvider implements SpeechToTextProvider {
  readonly id: string;
  readonly name = "Simulated STT";
  readonly version = "1.0.0";
  readonly capabilities = {
    streaming: true,
    multilingual: true,
    interruption: true,
    partialResults: true,
    reconnect: true,
  } as const;

  private sessionId: string | null = null;
  private transcript = "";
  private accumulatedMs = 0;
  private spokenChars = 0;
  private lastPartialText = "";
  private finalizedText = "";
  private reconnectCount = 0;

  constructor(providerId = "stt.simulated") {
    super();
    this.id = providerId;
  }

  private get options(): SimulatedSttOptions {
    return (this.config?.metadata as SimulatedSttOptions | undefined) ?? {};
  }

  override async initialize(config: Parameters<BaseProvider["initialize"]>[0]): Promise<void> {
    await super.initialize(config);
    telemetry.recordProviderMetric(this.id, "initializations", 1);
  }

  async startRecognition(session: VoiceSession): Promise<void> {
    this.requireRunning();
    if (this.sessionId) {
      throw makeProviderError("SERVICE_UNAVAILABLE", "Recognition is already running.", false);
    }
    this.transcript = typeof session.metadata?.transcript === "string" ? session.metadata.transcript : "";
    this.accumulatedMs = 0;
    this.spokenChars = 0;
    this.lastPartialText = "";
    this.finalizedText = "";
    this.sessionId = session.id;
    telemetry.info("stt.simulated", `Recognition started for session ${session.id}`);
    telemetry.getEmitter().emit("provider", Emit.RECOGNITION_STARTED, {
      providerId: this.id,
      sessionId: session.id,
    });
  }

  async stopRecognition(): Promise<void> {
    this.sessionId = null;
  }

  async writeAudio(chunk: AudioChunk): Promise<void> {
    this.requireRunning();
    if (!this.sessionId) {
      throw makeProviderError("SERVICE_UNAVAILABLE", "Recognition not started.", true);
    }
    if (this.forcedUnhealthy) {
      throw makeProviderError("CONNECTION_LOST", "STT connection lost.", true);
    }
    const energy = computeEnergy(chunk);
    this.accumulatedMs += chunk.durationMs;

    if (!this.transcript) {
      await sleep(Math.min(8, this.simulatedLatencyMs));
      return;
    }

    const charsPerChunk = Math.max(
      1,
      Math.floor(this.transcript.length / Math.max(1, (this.options.partialsPerUtterance ?? 3) + 1)),
    );
    const targetChars = Math.min(
      this.transcript.length,
      Math.floor(this.accumulatedMs / (this.options.chunkDurationMs ?? 400)) * charsPerChunk + charsPerChunk,
    );

    const reachedEnd = this.spokenChars >= this.transcript.length;
    const silenceGap = energy < 0.02 && this.accumulatedMs > (this.transcript.length / 4) * (this.options.chunkDurationMs ?? 400) + (this.options.utteranceGapMs ?? 600);
    const shouldFinalize = reachedEnd || (this.options.finalizeOnSilence !== false && silenceGap);

    if (targetChars > this.spokenChars) {
      this.spokenChars = targetChars;
      const partialText = this.transcript.slice(0, targetChars);
      if (partialText !== this.lastPartialText) {
        this.lastPartialText = partialText;
        telemetry.getEmitter().emit("provider", Emit.PARTIAL_TRANSCRIPT, {
          providerId: this.id,
          text: partialText,
          confidence: 0.9,
        });
        await sleep(Math.min(15, this.simulatedLatencyMs));
      }
    }

    if (shouldFinalize && this.finalizedText !== this.transcript) {
      this.finalizedText = this.transcript;
      telemetry.getEmitter().emit("provider", Emit.FINAL_TRANSCRIPT, {
        providerId: this.id,
        text: this.transcript,
        confidence: 0.95,
      });
    }
  }

  getLastPartialText(): string {
    return this.lastPartialText;
  }

  getFinalTranscript(): string | null {
    return this.finalizedText || null;
  }

  isUtteranceComplete(): boolean {
    return this.finalizedText === this.transcript && this.transcript !== "";
  }

  async reconnect(session: VoiceSession): Promise<void> {
    this.reconnectCount++;
    await this.stopRecognition();
    this.state = "running";
    this.healthyFlag = true;
    await this.startRecognition(session);
    telemetry.getEmitter().emit("provider", Emit.RECONNECTED, {
      providerId: this.id,
      attempt: this.reconnectCount,
    });
  }

  getReconnectCount(): number {
    return this.reconnectCount;
  }
}
