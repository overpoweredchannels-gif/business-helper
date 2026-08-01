import type { AudioOutputModule } from "../speech/contracts";
import type { AudioChunk, AudioStream } from "../providers/types";
import type { AudioDeviceDescriptor, AudioOutputState } from "../speech/types";
import { voiceEvents } from "../telemetry";
import { SpeechRuntimeEventNames as Emit } from "../events";

/**
 * Buffered audio output module. Consumes an AudioStream chunk-by-chunk,
 * holding up to `bufferSize` chunks in flight and emitting speech.tts_chunk
 * for each produced chunk and speech.playback_completed on completion.
 * `stop()` interrupts playback and resets the buffer.
 */
export class BufferedAudioOutputModule implements AudioOutputModule {
  private state: AudioOutputState = "closed";
  private device: AudioDeviceDescriptor | null = null;
  private buffer: AudioChunk[] = [];
  private playedChunks = 0;
  private interrupted = false;
  private requestId: string | null = null;
  private previousState: AudioOutputState = "closed";

  constructor(private bufferSize = 8) {}

  async open(device: AudioDeviceDescriptor): Promise<void> {
    this.device = device;
    this.state = "opened";
  }

  async close(): Promise<void> {
    await this.stop();
    this.state = "closed";
    this.device = null;
  }

  async play(stream: AudioStream): Promise<void> {
    if (this.state === "closed") {
      throw new Error("Audio output must be opened before playback.");
    }
    this.state = "playing";
    this.buffer = [];
    this.interrupted = false;
    this.playedChunks = 0;

    for await (const chunk of stream) {
      if (this.interrupted) {
        this.buffer = [];
        break;
      }
      this.buffer.push(chunk);
      voiceEvents.emit("speech", Emit.TTS_CHUNK, { sequence: chunk.sequence, durationMs: chunk.durationMs });
      while (this.buffer.length > this.bufferSize) {
        const ready = this.buffer.shift();
        if (ready) this.consume(ready);
      }
      if (chunk.isFinal) {
        break;
      }
    }
    while (this.buffer.length > 0) {
      const ready = this.buffer.shift();
      if (ready) this.consume(ready);
    }
    const requestId = this.requestId ?? null;
    this.requestId = null;
    this.state = "opened";
    voiceEvents.emit("speech", Emit.PLAYBACK_COMPLETED, { requestId: requestId ?? "" });
  }

  private consume(_chunk: AudioChunk): void {
    this.playedChunks++;
  }

  async pause(): Promise<void> {
    if (this.state !== "playing") return;
    this.previousState = "playing";
    this.state = "paused";
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    this.state = "playing";
  }

  async stop(): Promise<void> {
    this.interrupted = true;
    this.buffer = [];
    if (this.state === "playing" || this.state === "paused") {
      this.state = "opened";
    }
  }

  getState(): AudioOutputState {
    return this.state;
  }

  getPlayedChunks(): number {
    return this.playedChunks;
  }

  setRequestId(requestId: string | null): void {
    this.requestId = requestId;
  }
}
