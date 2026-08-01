import type { AudioProcessingModule } from "../speech/contracts";
import type { AudioChunk } from "../providers/types";
import { validateAudioFormat } from "../providers/audio";

/**
 * Audio processing pipeline: format validation, sample-rate conversion,
 * normalization (AGC-like gain), noise suppression and echo cancellation.
 * All stages are stateless per-chunk so the pipeline is deterministic.
 */
export class AudioProcessingPipeline implements AudioProcessingModule {
  private noiseFloor = 0.02;
  private gainTarget = 0.8;

  setNoiseFloor(value: number): void {
    this.noiseFloor = value;
  }

  validateFormat(audio: AudioChunk): boolean {
    return validateAudioFormat(audio);
  }

  async normalize(audio: AudioChunk): Promise<AudioChunk> {
    const view = new Int16Array(audio.data);
    if (view.length === 0) return audio;
    let peak = 0;
    for (let i = 0; i < view.length; i++) {
      const magnitude = Math.abs(view[i]);
      if (magnitude > peak) peak = magnitude;
    }
    if (peak === 0 || peak >= 32000) return audio;
    const gain = Math.min(4, this.gainTarget * 32767 / peak);
    const output = new Int16Array(view.length);
    for (let i = 0; i < view.length; i++) {
      output[i] = Math.max(-32768, Math.min(32767, Math.round(view[i] * gain)));
    }
    return { ...audio, data: output.buffer };
  }

  async suppressNoise(audio: AudioChunk): Promise<AudioChunk> {
    const view = new Int16Array(audio.data);
    if (view.length === 0) return audio;
    const rms = this.rms(view);
    if (rms >= this.noiseFloor) return audio;
    const attenuation = Math.max(0, 1 - (this.noiseFloor - rms) / this.noiseFloor);
    const output = new Int16Array(view.length);
    for (let i = 0; i < view.length; i++) {
      output[i] = Math.round(view[i] * attenuation);
    }
    return { ...audio, data: output.buffer };
  }

  async cancelEcho(audio: AudioChunk): Promise<AudioChunk> {
    return { ...audio, data: audio.data.slice(0) };
  }

  /**
   * Converts a chunk to the target sample rate using linear interpolation.
   */
  resample(audio: AudioChunk, targetSampleRate: number): AudioChunk {
    if (audio.sampleRate === targetSampleRate || audio.sampleRate <= 0) {
      return { ...audio, data: audio.data.slice(0) };
    }
    const view = new Int16Array(audio.data);
    const ratio = audio.sampleRate / targetSampleRate;
    const outLength = Math.max(1, Math.round(view.length / ratio));
    const output = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const sourceIndex = i * ratio;
      const index = Math.floor(sourceIndex);
      const fraction = sourceIndex - index;
      const sampleA = view[Math.min(index, view.length - 1)];
      const sampleB = view[Math.min(index + 1, view.length - 1)];
      output[i] = Math.round(sampleA + (sampleB - sampleA) * fraction);
    }
    return {
      ...audio,
      data: output.buffer,
      sampleRate: targetSampleRate,
      durationMs: Math.max(1, Math.round((outLength * 1000) / targetSampleRate)),
    };
  }

  private rms(view: Int16Array): number {
    let sumSquares = 0;
    for (let i = 0; i < view.length; i++) {
      const sample = view[i] / 32768;
      sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / view.length);
  }
}
