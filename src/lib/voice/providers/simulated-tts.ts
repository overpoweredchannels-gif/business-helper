import { BaseProvider, makeProviderError, sleep } from "./base";
import type { TextToSpeechProvider } from "./contracts";
import type { AudioChunk, AudioStream, SpeechRequest } from "./types";
import { createAudioChunk } from "./audio";
import { telemetry } from "../telemetry";
import { ProviderRuntimeEventNames as Emit } from "../events";

export interface SimulatedTtsOptions {
  charsPerChunk?: number;
  chunkDurationMs?: number;
  voice?: string;
}

/**
 * In-process streaming TTS provider. Synthesizes an AudioStream of PCM chunks
 * from text. Supports cancellation (stopSynthesis), voice configuration and
 * language metadata. Emits synthesis events through the runtime event bus.
 */
export class SimulatedTtsProvider extends BaseProvider implements TextToSpeechProvider {
  readonly id: string;
  readonly name = "Simulated TTS";
  readonly version = "1.0.0";
  readonly capabilities = {
    streaming: true,
    multilingual: true,
    interruption: true,
    partialResults: false,
    reconnect: true,
  } as const;

  private activeGenerator: AsyncGenerator<AudioChunk> | null = null;
  private cancelled = false;
  private requestCounter = 0;

  constructor(providerId = "tts.simulated") {
    super();
    this.id = providerId;
  }

  private get options(): SimulatedTtsOptions {
    return (this.config?.metadata as SimulatedTtsOptions | undefined) ?? {};
  }

  override async initialize(config: Parameters<BaseProvider["initialize"]>[0]): Promise<void> {
    await super.initialize(config);
    telemetry.recordProviderMetric(this.id, "initializations", 1);
  }

  async synthesize(request: SpeechRequest): Promise<AudioStream> {
    this.requireRunning();
    if (this.forcedUnhealthy) {
      throw makeProviderError("CONNECTION_LOST", "TTS connection lost.", true);
    }
    if (!request.text || request.text.trim().length === 0) {
      throw makeProviderError("INVALID_CONFIGURATION", "TTS request requires non-empty text.", false);
    }
    this.requestCounter++;
    const requestId = `tts_${Date.now()}_${this.requestCounter}`;
    this.cancelled = false;

    telemetry.info("tts.simulated", `Synthesis started: "${request.text.slice(0, 40)}..."`);
    telemetry.getEmitter().emit("provider", Emit.SYNTHESIS_STARTED, { providerId: this.id, requestId });

    const charsPerChunk = this.options.charsPerChunk ?? 12;
    const chunkDurationMs = this.options.chunkDurationMs ?? 300;
    const chunks: AudioChunk[] = [];
    let remaining = request.text;
    let sequence = 0;
    while (remaining.length > 0) {
      const part = remaining.slice(0, charsPerChunk);
      remaining = remaining.slice(charsPerChunk);
      chunks.push({
        ...createAudioChunk(chunkDurationMs, { frequency: 220 + (sequence % 3) * 60 }),
        sequence,
        isFinal: remaining.length === 0,
      });
      sequence++;
    }
    if (chunks.length === 0) {
      chunks.push({
        ...createAudioChunk(200, { silent: true }),
        sequence: 0,
        isFinal: true,
      });
    }

    const generator = (async function* (this: SimulatedTtsProvider) {
      for (const chunk of chunks) {
        if (this.cancelled) {
          return;
        }
        yield chunk;
        await sleep(Math.min(20, this.simulatedLatencyMs));
      }
    }).call(this);

    this.activeGenerator = generator;
    return generator;
  }

  async stopSynthesis(): Promise<void> {
    this.cancelled = true;
    this.activeGenerator = null;
  }

  async cancelRequest(requestId: string): Promise<void> {
    this.cancelled = true;
  }

  getRequestCount(): number {
    return this.requestCounter;
  }
}
