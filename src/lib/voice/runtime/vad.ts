import type { VoiceActivityDetectionModule } from "../speech/contracts";
import type { AudioChunk } from "../providers/types";
import type { VadConfiguration, VadResult, VadState } from "../speech/types";
import { computeEnergy } from "../providers/audio";
import { voiceEvents } from "../telemetry";
import { SpeechRuntimeEventNames as Emit } from "../events";

const MODE_THRESHOLDS: Record<NonNullable<VadConfiguration["mode"]>, number> = {
  aggressive: 0.15,
  moderate: 0.25,
  sensitive: 0.35,
};

/**
 * Energy-based voice activity detection with configurable sensitivity modes,
 * speech/silence tracking and timeouts. Emits speech.speech_detected,
 * speech.speech_started, speech.speech_ended and speech.silence_detected.
 */
export class EnergyVadModule implements VoiceActivityDetectionModule {
  private state: VadState = "idle";
  private config: VadConfiguration;
  private silenceMs = 0;
  private speechMs = 0;
  private inSpeech = false;
  private lastSpeechDetectedEmitted = false;
  private processedChunks = 0;

  constructor(config: VadConfiguration) {
    this.config = config;
  }

  setConfig(config: VadConfiguration): void {
    this.config = config;
  }

  async start(): Promise<void> {
    this.state = "detecting";
    this.silenceMs = 0;
    this.speechMs = 0;
    this.inSpeech = false;
  }

  async stop(): Promise<void> {
    this.state = "idle";
    this.inSpeech = false;
  }

  getState(): VadState {
    return this.state;
  }

  isInSpeech(): boolean {
    return this.inSpeech;
  }

  getSilenceMs(): number {
    return this.silenceMs;
  }

  getProcessedChunks(): number {
    return this.processedChunks;
  }

  private get speechThreshold(): number {
    return this.config.speechThreshold ?? MODE_THRESHOLDS[this.config.mode ?? "moderate"];
  }

  private get silenceThreshold(): number {
    return this.config.silenceThreshold ?? this.speechThreshold * 0.6;
  }

  private get minSpeechDurationMs(): number {
    return this.config.minSpeechDurationMs ?? 80;
  }

  async processAudio(audio: AudioChunk): Promise<VadResult> {
    const energy = computeEnergy(audio);
    this.processedChunks++;
    const speechDetectedSample = energy >= this.speechThreshold;

    if (speechDetectedSample) {
      this.speechMs += audio.durationMs;
      this.silenceMs = 0;
      if (!this.inSpeech && this.speechMs >= this.minSpeechDurationMs) {
        this.inSpeech = true;
        this.state = "speech";
        voiceEvents.emit("speech", Emit.VAD_SPEECH_STARTED, {});
      } else if (!this.inSpeech && !this.lastSpeechDetectedEmitted) {
        this.lastSpeechDetectedEmitted = true;
        voiceEvents.emit("speech", Emit.VAD_SPEECH_DETECTED, { energy });
      }
    } else {
      this.speechMs = 0;
      this.silenceMs += audio.durationMs;
      if (this.inSpeech) {
        if (this.silenceMs >= this.config.silenceTimeoutMs) {
          this.inSpeech = false;
          this.state = "silence";
          voiceEvents.emit("speech", Emit.VAD_SPEECH_ENDED, { reason: "silence_timeout" });
        } else {
          this.state = "speech";
        }
      } else if (this.silenceMs >= this.config.silenceTimeoutMs) {
        this.state = "silence";
        voiceEvents.emit("speech", Emit.VAD_SILENCE, { silenceMs: this.silenceMs });
      }
    }

    if (this.inSpeech) {
      this.lastSpeechDetectedEmitted = false;
    }

    return {
      speechDetected: this.inSpeech,
      energy,
      timestamp: Date.now(),
    };
  }
}
