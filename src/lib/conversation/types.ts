export type Channel = "web" | "voice" | "whatsapp" | "phone" | "mcp" | "desktop" | "mobile";

export interface ChannelMetadata {
  userAgent?: string;
  platform?: string;
  locale?: string;
  timezone?: string;
  ipAddress?: string;
}
