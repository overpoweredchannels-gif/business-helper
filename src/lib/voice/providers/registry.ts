import { DEFAULT_RETRY_POLICY } from "./base";
import type { ProviderConfiguration, ProviderHealth, RetryPolicy } from "./types";
import type { SpeechToTextProvider, TextToSpeechProvider } from "./contracts";
import { SimulatedSttProvider } from "./simulated-stt";
import { SimulatedTtsProvider } from "./simulated-tts";
import { WebSpeechSttProvider } from "./web-speech-stt";
import { WebSpeechTtsProvider } from "./web-speech-tts";
import { telemetry } from "../telemetry";
import { ProviderRuntimeEventNames as Emit } from "../events";

export type ProviderKind = "stt" | "tts";

export interface ProviderRegistryOptions {
  healthCheckIntervalMs?: number;
  failoverEnabled?: boolean;
}

export interface ProviderRegistration {
  provider: SpeechToTextProvider | TextToSpeechProvider;
  kind: ProviderKind;
  config: ProviderConfiguration;
  registeredAt: Date;
}

export function createSttProvider(providerId: string): SpeechToTextProvider {
  switch (providerId) {
    case "stt.simulated":
      return new SimulatedSttProvider(providerId);
    case "stt.web-speech":
      return new WebSpeechSttProvider(providerId);
    default:
      throw new Error(`Unknown STT provider: ${providerId}`);
  }
}

export function createTtsProvider(providerId: string): TextToSpeechProvider {
  switch (providerId) {
    case "tts.simulated":
      return new SimulatedTtsProvider(providerId);
    case "tts.web-speech":
      return new WebSpeechTtsProvider(providerId);
    default:
      throw new Error(`Unknown TTS provider: ${providerId}`);
  }
}

export function buildProviderConfiguration(providerId: string, metadata: Record<string, unknown>, retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY): ProviderConfiguration {
  return {
    providerId,
    timeoutMs: 10000,
    retryPolicy,
    metadata,
  };
}

/**
 * Registry of STT/TTS providers with lifecycle management, periodic health
 * monitoring and automatic failover between primary and backup providers.
 * Emits provider.* runtime events on registration, health transitions and
 * failovers.
 */
export class ProviderRegistry {
  private stt: Map<string, SpeechToTextProvider> = new Map();
  private tts: Map<string, TextToSpeechProvider> = new Map();
  private sttConfigs: Map<string, ProviderConfiguration> = new Map();
  private ttsConfigs: Map<string, ProviderConfiguration> = new Map();
  private sttOrder: string[] = [];
  private ttsOrder: string[] = [];
  private healthStates: Map<string, boolean> = new Map();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private options: Required<ProviderRegistryOptions>;

  constructor(options: ProviderRegistryOptions = {}) {
    this.options = {
      healthCheckIntervalMs: options.healthCheckIntervalMs ?? 5000,
      failoverEnabled: options.failoverEnabled ?? true,
    };
  }

  get activeSttOrder(): readonly string[] {
    return this.sttOrder;
  }

  get activeTtsOrder(): readonly string[] {
    return this.ttsOrder;
  }

  registerStt(provider: SpeechToTextProvider, metadata: Record<string, unknown> = {}, retryPolicy?: RetryPolicy): void {
    this.stt.set(provider.id, provider);
    this.sttConfigs.set(provider.id, buildProviderConfiguration(provider.id, metadata, retryPolicy));
    this.sttOrder.push(provider.id);
    this.healthStates.set(provider.id, true);
    telemetry.getEmitter().emit("provider", Emit.REGISTERED, { providerId: provider.id, kind: "stt" });
  }

  registerTts(provider: TextToSpeechProvider, metadata: Record<string, unknown> = {}, retryPolicy?: RetryPolicy): void {
    this.tts.set(provider.id, provider);
    this.ttsConfigs.set(provider.id, buildProviderConfiguration(provider.id, metadata, retryPolicy));
    this.ttsOrder.push(provider.id);
    this.healthStates.set(provider.id, true);
    telemetry.getEmitter().emit("provider", Emit.REGISTERED, { providerId: provider.id, kind: "tts" });
  }

  hasStt(providerId: string): boolean {
    return this.stt.has(providerId);
  }

  hasTts(providerId: string): boolean {
    return this.tts.has(providerId);
  }

  getStt(providerId: string): SpeechToTextProvider {
    const provider = this.stt.get(providerId);
    if (!provider) {
      throw new Error(`STT provider not registered: ${providerId}`);
    }
    return provider;
  }

  getTts(providerId: string): TextToSpeechProvider {
    const provider = this.tts.get(providerId);
    if (!provider) {
      throw new Error(`TTS provider not registered: ${providerId}`);
    }
    return provider;
  }

  getSttConfig(providerId: string): ProviderConfiguration {
    const config = this.sttConfigs.get(providerId);
    if (!config) {
      throw new Error(`STT provider not registered: ${providerId}`);
    }
    return config;
  }

  getTtsConfig(providerId: string): ProviderConfiguration {
    const config = this.ttsConfigs.get(providerId);
    if (!config) {
      throw new Error(`TTS provider not registered: ${providerId}`);
    }
    return config;
  }

  async initializeAll(): Promise<void> {
    for (const [providerId, provider] of this.stt) {
      await provider.initialize(this.sttConfigs.get(providerId)!);
      telemetry.getEmitter().emit("provider", Emit.INITIALIZED, { providerId });
    }
    for (const [providerId, provider] of this.tts) {
      await provider.initialize(this.ttsConfigs.get(providerId)!);
      telemetry.getEmitter().emit("provider", Emit.INITIALIZED, { providerId });
    }
  }

  async startAll(): Promise<void> {
    for (const [providerId, provider] of this.stt) {
      await provider.start();
      telemetry.getEmitter().emit("provider", Emit.STARTED, { providerId });
    }
    for (const [providerId, provider] of this.tts) {
      await provider.start();
      telemetry.getEmitter().emit("provider", Emit.STARTED, { providerId });
    }
  }

  async stopAll(): Promise<void> {
    for (const [providerId, provider] of this.stt) {
      await provider.stop();
      telemetry.getEmitter().emit("provider", Emit.STOPPED, { providerId });
    }
    for (const [providerId, provider] of this.tts) {
      await provider.stop();
      telemetry.getEmitter().emit("provider", Emit.STOPPED, { providerId });
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  startHealthMonitoring(): void {
    if (this.healthTimer) return;
    const check = async (): Promise<void> => {
      await this.checkHealth();
    };
    this.healthTimer = setInterval(() => {
      void check();
    }, this.options.healthCheckIntervalMs);
  }

  stopHealthMonitoring(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  async checkHealth(): Promise<void> {
    await this.checkProviderHealth(this.stt, Emit.UNHEALTHY);
    await this.checkProviderHealth(this.tts, Emit.UNHEALTHY);
  }

  private async checkProviderHealth(
    providers: Map<string, SpeechToTextProvider | TextToSpeechProvider>,
    unhealthyEvent: typeof Emit.UNHEALTHY,
  ): Promise<void> {
    for (const [providerId, provider] of providers) {
      const health = await provider.health();
      const wasHealthy = this.healthStates.get(providerId) ?? true;
      this.healthStates.set(providerId, health.healthy);
      if (health.healthy && !wasHealthy) {
        telemetry.getEmitter().emit("provider", Emit.RECOVERED, { providerId });
        this.healthStates.set(providerId, true);
      } else if (!health.healthy && wasHealthy) {
        telemetry.getEmitter().emit("provider", unhealthyEvent, {
          providerId,
          error: health.message ?? "Health check failed",
        });
      }
    }
  }

  isProviderHealthy(providerId: string): boolean {
    return this.healthStates.get(providerId) ?? false;
  }

  /**
   * Returns the preferred healthy provider of the given kind. When the
   * primary is unhealthy and failover is enabled, selects the first healthy
   * backup and emits failover events.
   */
  async selectProvider(kind: ProviderKind): Promise<string> {
    const order = kind === "stt" ? this.sttOrder : this.ttsOrder;
    if (order.length === 0) {
      throw new Error(`No ${kind} providers registered.`);
    }
    const primaryId = order[0];
    const primaryHealthy = this.isProviderHealthy(primaryId);
    if (primaryHealthy || !this.options.failoverEnabled) {
      return primaryId;
    }
    for (const candidateId of order.slice(1)) {
      if (this.isProviderHealthy(candidateId)) {
        telemetry.getEmitter().emit("provider", kind === "stt" ? Emit.FAILOVER_BACKUP : Emit.FAILOVER_BACKUP, {
          providerId: candidateId,
        });
        return candidateId;
      }
    }
    return primaryId;
  }

  async getActiveStt(): Promise<SpeechToTextProvider> {
    return this.getStt(await this.selectProvider("stt"));
  }

  async getActiveTts(): Promise<TextToSpeechProvider> {
    return this.getTts(await this.selectProvider("tts"));
  }

  async healthSnapshot(): Promise<Record<string, ProviderHealth>> {
    const result: Record<string, ProviderHealth> = {};
    for (const [providerId, provider] of this.stt) {
      result[providerId] = await provider.health();
    }
    for (const [providerId, provider] of this.tts) {
      result[providerId] = await provider.health();
    }
    return result;
  }

  async failoverToPrimary(kind: ProviderKind): Promise<string> {
    const order = kind === "stt" ? this.sttOrder : this.ttsOrder;
    const primaryId = order[0];
    if (primaryId) {
      telemetry.getEmitter().emit("provider", Emit.FAILOVER_PRIMARY, { providerId: primaryId });
    }
    return primaryId;
  }

  getRegistrations(): ProviderRegistration[] {
    const registrations: ProviderRegistration[] = [];
    for (const [providerId, provider] of this.stt) {
      registrations.push({
        provider,
        kind: "stt",
        config: this.sttConfigs.get(providerId)!,
        registeredAt: new Date(),
      });
    }
    for (const [providerId, provider] of this.tts) {
      registrations.push({
        provider,
        kind: "tts",
        config: this.ttsConfigs.get(providerId)!,
        registeredAt: new Date(),
      });
    }
    return registrations;
  }
}

export const providerRegistry = new ProviderRegistry();
