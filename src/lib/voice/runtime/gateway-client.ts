import { getGateway, type ConversationGateway, type GatewayMetrics } from "@/lib/conversation/gateway";
import type { ChatRequest, ChatResponse, StreamEvent } from "@/lib/conversation/contracts";
import type { Channel } from "@/lib/conversation/types";
import { voiceEvents } from "../telemetry";
import { SdkRuntimeEventNames as Emit } from "../events";

export const VOICE_CHANNEL: Channel = "voice";

export interface GatewaySendInput {
  sessionId: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  message: string;
  channel?: Channel;
}

export interface GatewaySendResult {
  ok: boolean;
  text: string;
  conversationId: string;
  requestId: string;
  error?: string;
}

export interface GatewayStreamResult {
  parts: string[];
  text: string;
  conversationId: string;
  ok: boolean;
}

/**
 * Voice Gateway Client. The single integration point between the Voice
 * Runtime and the Conversation Gateway — all voice messages are exchanged
 * through the gateway (channel "voice"); the Business Brain is never called
 * directly by runtime code.
 */
export class VoiceGatewayClient {
  readonly channel: Channel = VOICE_CHANNEL;

  constructor(private gateway: ConversationGateway = getGateway()) {}

  async sendMessage(input: GatewaySendInput): Promise<GatewaySendResult> {
    const request: ChatRequest = {
      message: input.message,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      userId: input.userId,
      organizationId: input.organizationId,
      channel: input.channel ?? this.channel,
    };
    voiceEvents.emit("sdk", Emit.GATEWAY_SENT, {
      sessionId: input.sessionId,
      messageLength: input.message.length,
    });
    const response: ChatResponse = await this.gateway.chat(request);
    return {
      ok: response.ok,
      text: response.message,
      conversationId: response.conversationId,
      requestId: response.requestId,
      error: response.error,
    };
  }

  async streamMessage(input: GatewaySendInput): Promise<GatewayStreamResult> {
    const request: ChatRequest = {
      message: input.message,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      userId: input.userId,
      organizationId: input.organizationId,
      channel: input.channel ?? this.channel,
    };
    const parts: string[] = [];
    let conversationId = input.conversationId ?? "";
    let ok = false;
    for await (const event of this.gateway.chatStream(request) as AsyncIterable<StreamEvent>) {
      conversationId = event.conversationId || conversationId;
      if (event.type === "text" && event.text) {
        parts.push(event.text);
      } else if (event.type === "done") {
        ok = true;
      } else if (event.type === "error") {
        ok = false;
      }
    }
    return {
      parts,
      text: parts.join(""),
      conversationId,
      ok,
    };
  }

  getStatus(): ReturnType<ConversationGateway["getStatus"]> {
    return this.gateway.getStatus();
  }

  getMetrics(): GatewayMetrics {
    return this.gateway.getMetrics();
  }

  getGateway(): ConversationGateway {
    return this.gateway;
  }
}
