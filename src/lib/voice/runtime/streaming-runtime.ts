import type { AudioChunk, SpeechToTextProvider, VoiceSession } from "../providers";
import { SimulatedSttProvider } from "../providers/simulated-stt";
import { createAudioChunk } from "../providers/audio";
import { telemetry, voiceEvents } from "../telemetry";
import { StreamingRuntimeEventNames as Emit } from "../events";

export interface UtteranceResult {
  text: string;
  parts: string[];
  durationMs: number;
  ok: boolean;
}

export type UtteranceHandler = (transcript: string) => Promise<UtteranceResult>;

export interface StreamingRuntimeOptions {
  inputQueueLimit?: number;
  outputBufferMs?: number;
  stt?: SpeechToTextProvider;
  session?: VoiceSession;
}

/**
 * Streaming runtime: bidirectional stream orchestration with bounded input
 * queue (backpressure), incremental transcripts, streaming responses,
 * output buffering with underrun detection, per-phase latency sampling and
 * reconnect support.
 */
export class StreamingRuntime {
  private inputQueue: AudioChunk[] = [];
  private queueLimit: number;
  private outputBufferMs: number;
  private outputAccumulatedMs = 0;
  private outputUnderruns = 0;
  private active = false;
  private drainLoop: Promise<void> | null = null;
  private waiters: Array<() => void> = [];
  private utteranceHandler: UtteranceHandler | null = null;
  private reconnectAttempts = 0;
  private receivedChunks = 0;
  private transcripts: string[] = [];
  private responses: string[] = [];
  private inputDrops = 0;
  private lastHandledFinal: string | null = null;

  readonly stt: SpeechToTextProvider;
  readonly session: VoiceSession;

  constructor(options: StreamingRuntimeOptions = {}) {
    this.queueLimit = options.inputQueueLimit ?? 64;
    this.outputBufferMs = options.outputBufferMs ?? 1500;
    this.stt = options.stt ?? new SimulatedSttProvider();
    this.session = options.session ?? { id: `stream_${Date.now()}`, language: "en-US", sampleRate: 16000 };
  }

  setUtteranceHandler(handler: UtteranceHandler | null): void {
    this.utteranceHandler = handler;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    await this.stt.initialize({
      providerId: this.stt.id,
      timeoutMs: 10000,
      retryPolicy: { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 500, exponentialBackoff: true },
      metadata: {},
    });
    await this.stt.start();
    await this.stt.startRecognition(this.session);
    this.drainLoop = this.drain();
  }

  async stop(): Promise<void> {
    this.active = false;
    this.releaseWaiters();
    await this.stt.stopRecognition();
    await this.stt.stop();
    this.inputQueue = [];
    if (this.drainLoop) {
      await this.drainLoop.catch(() => undefined);
      this.drainLoop = null;
    }
  }

  async writeAudio(chunk: AudioChunk): Promise<void> {
    if (!this.active) {
      throw new Error("StreamingRuntime is not active. Call start() first.");
    }
    if (this.inputQueue.length >= this.queueLimit) {
      voiceEvents.emit("streaming", Emit.BACKPRESSURE_APPLIED, {
        queue: "input",
        size: this.inputQueue.length,
        limit: this.queueLimit,
      });
      await this.waitForRoom();
    }
    this.inputQueue.push(chunk);
    voiceEvents.emit("streaming", Emit.INPUT_CHUNK_RECEIVED, {
      sequence: chunk.sequence,
      bytes: chunk.data.byteLength,
    });
  }

  /** Ingests a finalized transcript directly (e.g. from the Speech Runtime). */
  async handleUtterance(transcript: string): Promise<UtteranceResult | null> {
    if (!this.utteranceHandler || !transcript.trim()) return null;
    if (this.lastHandledFinal === transcript) return null;
    this.lastHandledFinal = transcript;
    this.transcripts.push(transcript);
    voiceEvents.emit("streaming", Emit.TRANSCRIPT_FINAL, { text: transcript, confidence: 1 });
    const started = Date.now();
    const result = await this.utteranceHandler(transcript);
    const durationMs = Date.now() - started;
    for (const part of result.parts) {
      voiceEvents.emit("streaming", Emit.RESPONSE_PARTIAL, { text: part });
    }
    voiceEvents.emit("streaming", Emit.RESPONSE_COMPLETE, { text: result.text, durationMs });
    telemetry.recordLatency("gateway", durationMs);
    this.responses.push(result.text);
    this.bufferOutput(result.text);
    return result;
  }

  async triggerReconnect(): Promise<void> {
    this.reconnectAttempts++;
    voiceEvents.emit("streaming", Emit.RECONNECTING, { attempt: this.reconnectAttempts });
    await this.stt.stopRecognition();
    await this.stt.start();
    await this.stt.startRecognition(this.session);
    voiceEvents.emit("streaming", Emit.RECONNECTED, { attempt: this.reconnectAttempts });
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  getInputQueueSize(): number {
    return this.inputQueue.length;
  }

  getInputDrops(): number {
    return this.inputDrops;
  }

  getReceivedChunks(): number {
    return this.receivedChunks;
  }

  getTranscripts(): readonly string[] {
    return this.transcripts;
  }

  getResponses(): readonly string[] {
    return this.responses;
  }

  getOutputBufferMs(): number {
    return this.outputAccumulatedMs;
  }

  getOutputUnderruns(): number {
    return this.outputUnderruns;
  }

  getLatencyStats(phase: string): { samples: number; avgMs: number; minMs: number; maxMs: number } {
    return telemetry.getLatencyStats(phase);
  }

  private async drain(): Promise<void> {
    while (this.active || this.inputQueue.length > 0) {
      const chunk = this.inputQueue.shift();
      if (!chunk) {
        if (!this.active) break;
        voiceEvents.emit("streaming", Emit.INPUT_QUEUE_DRAINED, {});
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }
      this.receivedChunks++;
      voiceEvents.emit("streaming", Emit.LATENCY_SAMPLE, { phase: "stt", latencyMs: chunk.durationMs });
      telemetry.recordLatency("stt", chunk.durationMs);
      await this.consumeForStt(chunk);
      if (this.active) {
        const provider = this.stt as { getLastPartialText?: () => string; getFinalTranscript?: () => string | null };
        const partial = provider.getLastPartialText?.() ?? "";
        if (partial) {
          voiceEvents.emit("streaming", Emit.TRANSCRIPT_PARTIAL, { text: partial, confidence: 0.9 });
        }
        const final = provider.getFinalTranscript?.() ?? null;
        if (final && final !== this.lastHandledFinal) {
          await this.handleUtterance(final);
        }
      }
      this.signalRoom();
    }
  }

  private async consumeForStt(chunk: AudioChunk): Promise<void> {
    await this.stt.writeAudio(chunk);
  }

  private bufferOutput(text: string): void {
    const ms = Math.max(200, Math.min(3000, text.length * 60));
    this.outputAccumulatedMs += ms;
    if (this.outputAccumulatedMs > this.outputBufferMs * 2) {
      this.outputAccumulatedMs = this.outputBufferMs;
      this.outputUnderruns++;
      voiceEvents.emit("streaming", Emit.OUTPUT_BUFFER_UNDERRUN, { bufferMs: this.outputBufferMs });
    }
    void createAudioChunk(1);
  }

  private waitForRoom(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private signalRoom(): void {
    if (this.inputQueue.length < this.queueLimit) {
      this.releaseWaiters();
    }
  }

  private releaseWaiters(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter();
    }
  }
}
