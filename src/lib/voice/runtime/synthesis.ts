import type { SpeechSynthesisModule } from "../speech/contracts";
import type { AudioStream, SpeechRequest, TextToSpeechProvider } from "../providers";
import { voiceEvents } from "../telemetry";
import { SpeechRuntimeEventNames as Emit } from "../events";

export type SynthesisProviderResolver = (providerId: string) => Promise<TextToSpeechProvider>;

/**
 * SpeechSynthesisModule implementation. Resolves the active TTS provider and
 * produces the AudioStream for a request, emitting speech.tts_started and
 * speech.playback_started on the way. Playback itself is owned by the
 * AudioOutputModule.
 */
export class SpeechSynthesisModuleImpl implements SpeechSynthesisModule {
  private provider: TextToSpeechProvider | null = null;
  private providerId: string | null = null;
  private activeRequestId: string | null = null;
  private requestCounter = 0;

  constructor(private resolveProvider: SynthesisProviderResolver) {}

  async initialize(providerId: string): Promise<void> {
    this.providerId = providerId;
  }

  isInitialized(): boolean {
    return this.providerId !== null;
  }

  async synthesize(request: SpeechRequest): Promise<AudioStream> {
    const provider = await this.resolveProvider(this.providerId ?? "tts.simulated");
    this.provider = provider;
    this.requestCounter++;
    const requestId = `speech_req_${Date.now()}_${this.requestCounter}`;
    this.activeRequestId = requestId;
    voiceEvents.emit("speech", Emit.TTS_STARTED, { requestId });
    const stream = await provider.synthesize(request);
    voiceEvents.emit("speech", Emit.PLAYBACK_STARTED, { requestId });
    return stream;
  }

  async stopSynthesis(): Promise<void> {
    if (this.provider) {
      await this.provider.stopSynthesis();
    }
    this.activeRequestId = null;
  }

  getActiveRequestId(): string | null {
    return this.activeRequestId;
  }

  getProvider(): TextToSpeechProvider | null {
    return this.provider;
  }
}
