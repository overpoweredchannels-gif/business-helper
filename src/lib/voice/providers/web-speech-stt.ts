import { BaseProvider, makeProviderError } from "./base";
import type { SpeechToTextProvider } from "./contracts";
import type { AudioChunk, VoiceSession } from "./types";
import { telemetry } from "../telemetry";
import { ProviderRuntimeEventNames as Emit } from "../events";

interface WebSpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => WebSpeechRecognitionLike;

function resolveRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as RecognitionCtor | undefined;
  return ctor ?? null;
}

/**
 * Browser STT provider backed by the Web Speech API. In Node (tests) it fails
 * initialization cleanly; the registry falls back to the simulated provider.
 * Implements the SpeechToTextProvider contract; microphone audio is captured by
 * the browser itself, so writeAudio() rejects injected audio.
 */
export class WebSpeechSttProvider extends BaseProvider implements SpeechToTextProvider {
  readonly id: string;
  readonly name = "Web Speech STT";
  readonly version = "1.0.0";
  readonly capabilities = {
    streaming: true,
    multilingual: true,
    interruption: true,
    partialResults: true,
    reconnect: false,
  } as const;

  private recognition: WebSpeechRecognitionLike | null = null;
  private sessionId: string | null = null;
  private lastPartialText = "";
  private finalizedText = "";

  constructor(providerId = "stt.web-speech") {
    super();
    this.id = providerId;
  }

  override async initialize(config: Parameters<BaseProvider["initialize"]>[0]): Promise<void> {
    const ctor = resolveRecognitionCtor();
    if (!ctor) {
      throw makeProviderError(
        "INVALID_CONFIGURATION",
        "Web Speech API is not available in this environment.",
        false,
      );
    }
    await super.initialize(config);
    telemetry.recordProviderMetric(this.id, "initializations", 1);
  }

  async startRecognition(session: VoiceSession): Promise<void> {
    this.requireRunning();
    const ctor = resolveRecognitionCtor();
    if (!ctor) {
      throw makeProviderError("INVALID_CONFIGURATION", "Web Speech API is not available in this environment.", false);
    }
    if (this.recognition) {
      throw makeProviderError("SERVICE_UNAVAILABLE", "Recognition is already running.", false);
    }
    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = session.language ?? "en-US";
    this.lastPartialText = "";
    this.finalizedText = "";
    this.sessionId = session.id;

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        const confidence = result[0]?.confidence ?? 0.9;
        if (i < event.results.length - 1) {
          final += transcript;
        } else {
          interim += transcript;
        }
        void confidence;
      }
      this.lastPartialText = interim;
      if (final) {
        this.finalizedText = final;
        telemetry.getEmitter().emit("provider", Emit.FINAL_TRANSCRIPT, {
          providerId: this.id,
          text: final,
          confidence: 0.95,
        });
      }
    };
    recognition.onend = () => {
      this.recognition = null;
      this.sessionId = null;
      this.lastPartialText = "";
    };
    recognition.onerror = (event) => {
      telemetry.warn("stt.web-speech", `Recognition error: ${event.error}`);
      this.healthyFlag = false;
    };
    recognition.start();
    this.recognition = recognition;
    telemetry.getEmitter().emit("provider", Emit.RECOGNITION_STARTED, {
      providerId: this.id,
      sessionId: session.id,
    });
  }

  async stopRecognition(): Promise<void> {
    if (this.recognition) {
      this.recognition.abort();
      this.recognition = null;
    }
    this.sessionId = null;
  }

  async writeAudio(_chunk: AudioChunk): Promise<void> {
    throw makeProviderError("INVALID_AUDIO", "Web Speech captures microphone audio directly; audio injection is not supported.", false);
  }

  getLastPartialText(): string {
    return this.lastPartialText;
  }

  getFinalTranscript(): string | null {
    return this.finalizedText || null;
  }
}
