import type { AudioChunk } from "./types";

export const DEFAULT_SAMPLE_RATE = 16000;
export const DEFAULT_CHANNELS = 1;

export interface AudioChunkOptions {
  frequency?: number;
  amplitude?: number;
  silent?: boolean;
  sampleRate?: number;
  channels?: number;
}

export function createAudioChunk(
  durationMs: number,
  options: AudioChunkOptions = {},
): AudioChunk {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = options.channels ?? DEFAULT_CHANNELS;
  const frequency = options.frequency ?? 440;
  const amplitude = options.silent ? 0 : (options.amplitude ?? 0.25);
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const bytes = new ArrayBuffer(sampleCount * channels * 2);
  const view = new Int16Array(bytes);

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const value = amplitude * Math.sin(2 * Math.PI * frequency * t);
    view[i] = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
  }

  return {
    data: bytes,
    format: "pcm_s16le",
    sampleRate,
    channels,
    durationMs,
    sequence: 0,
    isFinal: false,
  };
}

export function createSilenceChunk(durationMs: number, sampleRate = DEFAULT_SAMPLE_RATE): AudioChunk {
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  return {
    data: new ArrayBuffer(sampleCount * 2),
    format: "pcm_s16le",
    sampleRate,
    channels: 1,
    durationMs,
    sequence: 0,
    isFinal: false,
  };
}

export function computeEnergy(chunk: AudioChunk): number {
  const view = new Int16Array(chunk.data);
  if (view.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < view.length; i++) {
    const sample = view[i] / 32768;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / view.length);
  return Math.min(1, rms * 4);
}

export function cloneChunk(chunk: AudioChunk, sequence: number): AudioChunk {
  return {
    data: chunk.data.slice(0),
    format: chunk.format,
    sampleRate: chunk.sampleRate,
    channels: chunk.channels,
    durationMs: chunk.durationMs,
    sequence,
    isFinal: chunk.isFinal,
  };
}

export function validateAudioFormat(chunk: AudioChunk): boolean {
  if (!chunk || !(chunk.data instanceof ArrayBuffer)) return false;
  if (chunk.data.byteLength <= 0) return false;
  if (!chunk.format || !chunk.sampleRate || chunk.sampleRate <= 0) return false;
  if (!Number.isFinite(chunk.durationMs) || chunk.durationMs <= 0) return false;
  return true;
}
