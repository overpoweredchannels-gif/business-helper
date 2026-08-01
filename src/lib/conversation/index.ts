export { ConversationGateway, getGateway } from "./gateway";
export type { GatewayMetrics } from "./gateway";

export type {
  ChatRequest,
  ChatResponse,
  GatewayError,
  ConfirmationRequest,
  ConfirmationResponse,
  StreamEvent,
  ChatStream,
} from "./contracts";
export type { StreamEventType } from "./contracts";
export { TCGP_VERSION, SUPPORTED_VERSIONS, VERSION_HEADER, CORRELATION_ID_HEADER } from "./contracts";
export type { Channel, ChannelMetadata } from "./types";
export { gatewayLogger } from "./logger";
export type { LogEntry, LogLevel } from "./logger";
export { ConversationClient, ClientError, TimeoutError, NetworkError, GatewayRequestError } from "./client";
export type { ConversationClientConfig } from "./client";
