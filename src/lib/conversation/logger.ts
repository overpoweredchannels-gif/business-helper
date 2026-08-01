export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  correlationId?: string;
  requestId?: string;
  conversationId?: string;
  channel?: string;
  version?: string;
  durationMs?: number;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

function formatLog(entry: LogEntry): string {
  return JSON.stringify({
    t: entry.timestamp,
    lvl: entry.level,
    evt: entry.event,
    cid: entry.correlationId,
    rid: entry.requestId,
    conv: entry.conversationId,
    ch: entry.channel,
    ver: entry.version,
    dur: entry.durationMs,
    msg: entry.message,
    err: entry.error,
    ...(entry.details ? { details: entry.details } : {}),
  });
}

function log(level: LogLevel, event: string, data?: Partial<LogEntry>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  const line = formatLog(entry);
  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "debug":
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

class GatewayLogger {
  debug(event: string, data?: Partial<LogEntry>): void {
    log("debug", event, data);
  }
  info(event: string, data?: Partial<LogEntry>): void {
    log("info", event, data);
  }
  warn(event: string, data?: Partial<LogEntry>): void {
    log("warn", event, data);
  }
  error(event: string, data?: Partial<LogEntry>): void {
    log("error", event, data);
  }
}

export const gatewayLogger = new GatewayLogger();
