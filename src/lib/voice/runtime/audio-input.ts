import type { AudioInputModule } from "../speech/contracts";
import type { AudioChunk } from "../providers/types";
import type { AudioDeviceDescriptor, AudioInputState } from "../speech/types";
import { voiceEvents } from "../telemetry";
import { SpeechRuntimeEventNames as Emit } from "../events";
import { makeProviderError } from "../providers/base";

type ChunkHandler = (chunk: AudioChunk) => Promise<void>;

interface Waiter {
  resolve: (chunk: AudioChunk) => void;
}

/**
 * Simulated microphone input module. In Node there is no real capture device;
 * audio is injected through `injectAudio()`. In browsers, `open()` could
 * attach to MediaDevices — the module stays environment-agnostic by design.
 */
export class SimulatedAudioInputModule implements AudioInputModule {
  private state: AudioInputState = "closed";
  private device: AudioDeviceDescriptor | null = null;
  private queue: AudioChunk[] = [];
  private waiter: Waiter | null = null;
  private loopActive = false;
  private chunksInjected = 0;
  private onChunk: ChunkHandler | null = null;

  constructor(private chunkSizeMs = 100) {}

  async open(device: AudioDeviceDescriptor): Promise<void> {
    this.device = device;
    this.state = "opened";
    voiceEvents.emit("speech", Emit.MIC_OPENED, { deviceId: device.deviceId });
  }

  async close(): Promise<void> {
    await this.stopCapture();
    this.state = "closed";
    this.device = null;
    this.queue = [];
    voiceEvents.emit("speech", Emit.MIC_CLOSED, {});
  }

  async startCapture(): Promise<void> {
    if (this.state !== "opened") {
      throw makeProviderError("SERVICE_UNAVAILABLE", "Audio input must be opened before capture.", true);
    }
    this.state = "capturing";
    this.loopActive = true;
    voiceEvents.emit("speech", Emit.INPUT_STARTED, { chunkSizeBytes: 0 });
    void this.captureLoop();
  }

  async stopCapture(): Promise<void> {
    this.loopActive = false;
    if (this.waiter) {
      this.waiter = null;
    }
    if (this.state === "capturing") {
      this.state = "opened";
      voiceEvents.emit("speech", Emit.INPUT_STOPPED, {});
    }
  }

  setChunkHandler(handler: ChunkHandler): void {
    this.onChunk = handler;
  }

  getState(): AudioInputState {
    return this.state;
  }

  getChunksInjected(): number {
    return this.chunksInjected;
  }

  async injectAudio(chunk: AudioChunk): Promise<void> {
    if (this.state === "closed") {
      throw makeProviderError("SERVICE_UNAVAILABLE", "Audio input is closed.", true);
    }
    this.chunksInjected++;
    const copies: AudioChunk[] = [];
    let offset = 0;
    let sequence = chunk.sequence;
    let remainingMs = chunk.durationMs;
    const sampleCount = chunk.data.byteLength / 2;
    const samplesPerChunk = Math.max(1, Math.floor((chunk.sampleRate * this.chunkSizeMs) / 1000));
    while (offset < sampleCount) {
      const count = Math.min(samplesPerChunk, sampleCount - offset);
      const part = chunk.data.slice(offset * 2, (offset + count) * 2);
      copies.push({
        data: part,
        format: chunk.format,
        sampleRate: chunk.sampleRate,
        channels: chunk.channels,
        durationMs: Math.min(this.chunkSizeMs, remainingMs),
        sequence,
        isFinal: offset + count >= sampleCount ? chunk.isFinal : false,
      });
      offset += count;
      sequence++;
      remainingMs -= this.chunkSizeMs;
    }
    for (const copy of copies) {
      if (this.waiter) {
        const waiter = this.waiter;
        this.waiter = null;
        waiter.resolve(copy);
      } else {
        this.queue.push(copy);
      }
    }
  }

  private async captureLoop(): Promise<void> {
    while (this.loopActive) {
      const chunk = await this.nextChunk();
      if (!this.loopActive || !chunk) break;
      if (this.onChunk) {
        await this.onChunk(chunk);
      }
    }
  }

  private nextChunk(): Promise<AudioChunk> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    if (!this.loopActive) {
      return new Promise((resolve) => setTimeout(() => resolve(this.queue.shift() as AudioChunk), 0));
    }
    return new Promise((resolve) => {
      this.waiter = { resolve };
    });
  }
}
