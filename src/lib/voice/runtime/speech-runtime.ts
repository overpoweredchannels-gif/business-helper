import type { SpeechRuntime } from "../speech/contracts";
import type { AudioChunk, SpeechRequest, VoiceSession } from "../providers";
import type { RuntimeHealth, SpeechRuntimeConfiguration, SpeechRuntimeState } from "../speech/types";
import { SimulatedAudioInputModule } from "./audio-input";
import { AudioProcessingPipeline } from "./audio-processing";
import { EnergyVadModule } from "./vad";
import { SpeechRecognitionModuleImpl, type ProviderResolver } from "./recognition";
import { SpeechSynthesisModuleImpl, type SynthesisProviderResolver } from "./synthesis";
import { BufferedAudioOutputModule } from "./audio-output";
import { RuntimeMonitoringModuleImpl } from "./monitoring";
import { providerRegistry, createSttProvider, createTtsProvider } from "../providers/registry";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../providers/contracts";
import { voiceEvents } from "../telemetry";
import { SpeechRuntimeEventNames as Emit } from "../events";

export interface SpeechRuntimeOptions {
  recognitionResolver?: ProviderResolver;
  synthesisResolver?: SynthesisProviderResolver;
  transcript?: string;
}

export function generateSessionId(prefix = "voice"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Production SpeechRuntime implementation orchestrating the audio pipeline:
 * mic capture → processing → VAD → STT, and TTS → buffered playback, with
 * full lifecycle management and runtime health reporting.
 */
export class SpeechRuntimeImpl implements SpeechRuntime {
  private state: SpeechRuntimeState = "created";
  private config: SpeechRuntimeConfiguration | null = null;
  private mockTranscript = "";
  private sessionId: string | null = null;
  private listeningStartedAt = 0;
  private recognitionStarted = false;
  private previousState: SpeechRuntimeState = "created";

  private readonly input: SimulatedAudioInputModule;
  private readonly processing: AudioProcessingPipeline;
  private readonly vad: EnergyVadModule;
  private readonly recognition: SpeechRecognitionModuleImpl;
  private readonly synthesis: SpeechSynthesisModuleImpl;
  private readonly output: BufferedAudioOutputModule;
  private readonly monitoring: RuntimeMonitoringModuleImpl;

  constructor(options: SpeechRuntimeOptions = {}) {
    this.input = new SimulatedAudioInputModule();
    this.processing = new AudioProcessingPipeline();
    this.vad = new EnergyVadModule({
      mode: "moderate",
      silenceTimeoutMs: 600,
    });
    this.recognition = new SpeechRecognitionModuleImpl(options.recognitionResolver ?? this.defaultRecognitionResolver);
    this.synthesis = new SpeechSynthesisModuleImpl(options.synthesisResolver ?? this.defaultSynthesisResolver);
    this.output = new BufferedAudioOutputModule();
    this.monitoring = new RuntimeMonitoringModuleImpl({
      getState: () => this.state,
      getInputState: () => this.input.getState(),
      getOutputState: () => this.output.getState(),
      sttConnected: () => this.recognition.isInitialized(),
      ttsConnected: () => this.synthesis.isInitialized(),
    });
  }

  private async defaultRecognitionResolver(providerId: string): Promise<SpeechToTextProvider> {
    const provider = providerRegistry.hasStt(providerId)
      ? await providerRegistry.getActiveStt()
      : createSttProvider(providerId);
    if (provider.getState() === "created") {
      await provider.initialize({
        providerId,
        timeoutMs: 10000,
        retryPolicy: { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 500, exponentialBackoff: true },
        metadata: {},
      });
      await provider.start();
    }
    return provider;
  }

  private async defaultSynthesisResolver(providerId: string): Promise<TextToSpeechProvider> {
    const provider = providerRegistry.hasTts(providerId)
      ? await providerRegistry.getActiveTts()
      : createTtsProvider(providerId);
    if (provider.getState() === "created") {
      await provider.initialize({
        providerId,
        timeoutMs: 10000,
        retryPolicy: { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 500, exponentialBackoff: true },
        metadata: {},
      });
      await provider.start();
    }
    return provider;
  }

  async initialize(config: SpeechRuntimeConfiguration): Promise<void> {
    if (this.state === "disposed") {
      throw new Error("SpeechRuntime is disposed.");
    }
    this.config = config;
    this.input.setChunkHandler((chunk) => this.handleChunk(chunk));
    this.vad.setConfig(config.vad);
    this.processing.setNoiseFloor(config.vad.silenceThreshold ?? 0.02);
    this.state = "initialized";
    voiceEvents.emit("speech", Emit.LIFECYCLE_INITIALIZED, { runtimeId: "speech-runtime" });
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw new Error("SpeechRuntime must be initialized before start.");
    }
    await this.recognition.initialize(this.config.sttProviderId);
    await this.synthesis.initialize(this.config.ttsProviderId);
    await this.output.open(this.config.audioOutputDevice);
    await this.vad.start();
    await this.monitoring.start();
    this.state = "idle";
    voiceEvents.emit("speech", Emit.LIFECYCLE_STARTED, { runtimeId: "speech-runtime" });
  }

  async stop(): Promise<void> {
    await this.stopListening();
    await this.output.stop();
    await this.output.close();
    await this.vad.stop();
    await this.monitoring.stop();
    if (this.state !== "disposed") {
      this.state = "stopped";
      voiceEvents.emit("speech", Emit.LIFECYCLE_STOPPED, { runtimeId: "speech-runtime" });
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.state = "disposed";
    voiceEvents.emit("speech", Emit.LIFECYCLE_DISPOSED, { runtimeId: "speech-runtime" });
  }

  async startListening(sessionId?: string): Promise<void> {
    if (!this.config) {
      throw new Error("SpeechRuntime must be initialized before startListening.");
    }
    if (this.state === "listening" || this.state === "recognizing") {
      return;
    }
    if (this.state !== "idle" && this.state !== "stopped" && this.state !== "initialized") {
      throw new Error(`Cannot startListening in state "${this.state}".`);
    }
    this.state = "listening";
    const session: VoiceSession = {
      id: sessionId ?? generateSessionId("speech"),
      language: this.config.preferredLanguage ?? "en-US",
      sampleRate: this.config.inputSampleRate,
      encoding: this.config.audioEncoding,
      metadata: this.mockTranscript ? { transcript: this.mockTranscript } : undefined,
    };
    this.sessionId = session.id;
    await this.input.open(this.config.audioInputDevice);
    await this.input.startCapture();
    await this.recognition.startRecognition(session);
    this.recognitionStarted = true;
    this.listeningStartedAt = Date.now();
  }

  async stopListening(): Promise<void> {
    if (!this.recognitionStarted && this.state !== "listening" && this.state !== "recognizing") {
      return;
    }
    this.recognitionStarted = false;
    await this.input.stopCapture();
    await this.input.close();
    await this.recognition.stopRecognition();
    this.sessionId = null;
    if (this.state === "listening" || this.state === "recognizing") {
      this.state = "idle";
    }
  }

  async speak(request: SpeechRequest): Promise<void> {
    if (!this.config) {
      throw new Error("SpeechRuntime must be initialized before speak.");
    }
    if (this.state === "speaking") {
      await this.interruptPlayback();
    }
    this.previousState = this.state === "speaking" ? "idle" : this.state;
    this.state = "speaking";
    try {
      const stream = await this.synthesis.synthesize(request);
      const requestId = this.synthesis.getActiveRequestId();
      this.output.setRequestId(requestId);
      await this.output.play(stream);
    } finally {
      this.state = this.previousState;
    }
  }

  async interruptPlayback(): Promise<void> {
    await this.synthesis.stopSynthesis();
    await this.output.stop();
    voiceEvents.emit("speech", Emit.PLAYBACK_INTERRUPTED, {});
    if (this.state === "speaking") {
      this.state = this.previousState;
    }
  }

  async getHealth(): Promise<RuntimeHealth> {
    return this.monitoring.reportHealth();
  }

  getState(): SpeechRuntimeState {
    return this.state;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Sets the expected transcript for the next recognition (simulated STT). */
  setMockTranscript(text: string): void {
    this.mockTranscript = text;
  }

  getModuleStates(): {
    input: string;
    vad: string;
    output: string;
  } {
    return {
      input: this.input.getState(),
      vad: this.vad.getState(),
      output: this.output.getState(),
    };
  }

  getOutputPlayedChunks(): number {
    return this.output.getPlayedChunks();
  }

  getPartialCount(): number {
    return this.recognition.getPartialCount();
  }

  getFinalCount(): number {
    return this.recognition.getFinalCount();
  }

  /** Injects simulated microphone audio while listening. */
  async injectAudio(chunk: AudioChunk): Promise<void> {
    await this.input.injectAudio(chunk);
  }

  private async handleChunk(chunk: AudioChunk): Promise<void> {
    if (!this.config || !this.recognitionStarted) return;
    if (!this.processing.validateFormat(chunk)) {
      voiceEvents.emit("speech", Emit.ERROR, { code: "INVALID_AUDIO", message: "Invalid audio chunk format." });
      return;
    }
    let audio = this.processing.resample(chunk, this.config.inputSampleRate);
    audio = await this.processing.normalize(audio);
    if (this.config.noiseSuppression) {
      audio = await this.processing.suppressNoise(audio);
    }
    if (this.config.echoCancellation) {
      audio = await this.processing.cancelEcho(audio);
    }
    const vadResult = await this.vad.processAudio(audio);
    voiceEvents.emit("speech", Emit.AUDIO_PROCESSED, {
      sequence: audio.sequence,
      energy: vadResult.energy,
      noiseSuppressed: Boolean(this.config.noiseSuppression),
    });
    if (vadResult.speechDetected) {
      await this.recognition.writeAudio(audio);
    }
    const timeoutMs = this.config.recognitionTimeoutMs;
    if (timeoutMs > 0 && Date.now() - this.listeningStartedAt > timeoutMs) {
      this.monitoring.setLastError("recognition_timeout");
      voiceEvents.emit("speech", Emit.ERROR, {
        code: "TIMEOUT",
        message: `Recognition timed out after ${timeoutMs}ms.`,
      });
      await this.stopListening();
    }
  }
}
