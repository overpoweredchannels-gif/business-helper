import type { RuntimeMonitoringModule } from "../speech/contracts";
import type { AudioInputState, AudioOutputState, RuntimeHealth, SpeechRuntimeState } from "../speech/types";

export interface MonitoringContext {
  getState(): SpeechRuntimeState;
  getInputState(): AudioInputState;
  getOutputState(): AudioOutputState;
  sttConnected(): boolean;
  ttsConnected(): boolean;
}

/**
 * Runtime monitoring module: tracks uptime, aggregates module/provider state
 * into a RuntimeHealth report.
 */
export class RuntimeMonitoringModuleImpl implements RuntimeMonitoringModule {
  private startedAt: number | null = null;
  private lastError: string | undefined;

  constructor(private context: MonitoringContext) {}

  async start(): Promise<void> {
    this.startedAt = Date.now();
  }

  async stop(): Promise<void> {
    this.startedAt = null;
  }

  setLastError(error: string | undefined): void {
    this.lastError = error;
  }

  async reportHealth(): Promise<RuntimeHealth> {
    const state = this.context.getState();
    const inputActive = this.context.getInputState() === "capturing";
    const outputActive = this.context.getOutputState() === "playing" || this.context.getOutputState() === "paused";
    const sttConnected = this.context.sttConnected();
    const ttsConnected = this.context.ttsConnected();
    const healthy =
      state !== "failed" &&
      state !== "created" &&
      sttConnected &&
      ttsConnected &&
      !this.lastError;
    return {
      healthy,
      sttConnected,
      ttsConnected,
      audioInputActive: inputActive,
      audioOutputActive: outputActive,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      lastError: this.lastError,
    };
  }
}
