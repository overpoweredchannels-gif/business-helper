import { BaseProvider, makeProviderError, sleep } from "./base";
import type { TextToSpeechProvider } from "./contracts";
import type { AudioChunk, AudioStream, SpeechRequest } from "./types";
import { createAudioChunk } from "./audio";
import { telemetry } from "../telemetry";
import { ProviderRuntimeEventNames as Emit } from "../events";

interface SpeechSynthesisUtteranceLike {
  text: string;
  lang: string;
  pitch: number;
  rate: number;
  voice: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
  getVoices(): unknown[];
}

function resolveSynthesis(): SpeechSynthesisLike | null {
  if (typeof window === "undefined") return null;
  const synthesis = window.speechSynthesis as SpeechSynthesisLike | undefined;
  return synthesis ?? null;
}

function resolveUtteranceCtor(): (new (text: string) => SpeechSynthesisUtteranceLike) | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance as
    | (new (text: string) => SpeechSynthesisUtteranceLike)
    | undefined ?? null;
}

/**
 * Browser TTS provider backed by the Web Speech synthesis API. Produces the
 * same PCM chunk stream as the simulated provider (so the runtime audio
 * pipeline is exercised identically) while the browser speaks the text aloud.
 * Node: initialization fails cleanly.
 */
export class WebSpeechTtsProvider extends BaseProvider implements TextToSpeechProvider {
  readonly id: string;
  readonly name = "Web Speech TTS";
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

  constructor(providerId = "tts.web-speech") {
    super();
    this.id = providerId;
  }

  override async initialize(config: Parameters<BaseProvider["initialize"]>[0]): Promise<void> {
    if (!resolveSynthesis() || !resolveUtteranceCtor()) {
      throw makeProviderError(
        "INVALID_CONFIGURATION",
        "Web Speech synthesis is not available in this environment.",
        false,
      );
    }
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
    const synthesis = resolveSynthesis();
    const UtteranceCtor = resolveUtteranceCtor();
    if (!synthesis || !UtteranceCtor) {
      throw makeProviderError("INVALID_CONFIGURATION", "Web Speech synthesis is not available in this environment.", false);
    }

    this.requestCounter++;
    const requestId = `tts_web_${Date.now()}_${this.requestCounter}`;
    this.cancelled = false;

    const utterance = new UtteranceCtor(request.text);
    utterance.lang = request.language ?? "en-US";
    utterance.pitch = request.pitch ?? 1;
    utterance.rate = request.rate ?? 1;
    let playbackDone: (() => void) | null = null;
    const playbackPromise = new Promise<void>((resolve) => {
      playbackDone = resolve;
    });
    utterance.onend = () => {
      playbackDone?.();
      telemetry.getEmitter().emit("provider", Emit.SYNTHESIS_COMPLETED, { providerId: this.id, requestId });
    };
    utterance.onerror = (event) => {
      telemetry.warn("tts.web-speech", `Synthesis error: ${event.error}`);
      playbackDone?.();
    };
    synthesis.speak(utterance);

    telemetry.info("tts.web-speech", `Synthesis started: "${request.text.slice(0, 40)}..."`);
    telemetry.getEmitter().emit("provider", Emit.SYNTHESIS_STARTED, { providerId: this.id, requestId });

    const charsPerChunk = 12;
    const chunkDurationMs = 300;
    const chunks: AudioChunk[] = [];
    let remaining = request.text;
    let sequence = 0;
    while (remaining.length > 0) {
      remaining = remaining.slice(charsPerChunk);
      chunks.push({
        ...createAudioChunk(chunkDurationMs, { frequency: 220 + (sequence % 3) * 60 }),
        sequence,
        isFinal: sequence === chunks.length,
      });
      sequence++;
    }

    const generator = (async function* (this: WebSpeechTtsProvider) {
      for (const chunk of chunks) {
        if (this.cancelled) {
          return;
        }
        yield chunk;
        await sleep(Math.min(20, this.simulatedLatencyMs));
      }
      await playbackPromise;
    }).call(this);

    this.activeGenerator = generator;
    return generator;
  }

  async stopSynthesis(): Promise<void> {
    this.cancelled = true;
    const synthesis = resolveSynthesis();
    if (synthesis) {
      synthesis.cancel();
    }
    this.activeGenerator = null;
  }

  async cancelRequest(_requestId: string): Promise<void> {
    await this.stopSynthesis();
  }

  getRequestCount(): number {
    return this.requestCounter;
  }
}
