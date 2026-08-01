export interface PiiFilterOptions {
  maskPhone?: boolean;
  maskName?: boolean;
  maskEmail?: boolean;
  maskAddress?: boolean;
  maskCnic?: boolean;
}

const PHONE_REGEX = /(03\d{2}[-\s]?\d{7}|\+92\d{3}[-\s]?\d{7})/g;
const CNIC_REGEX = /\d{5}[-\s]?\d{7}[-\s]?\d{1}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const ADDRESS_REGEX = /( house[:\s]?#?\d+| street[:\s]?#?\d+| road[:\s]?#?\d+| mohallah| colony| gali| kucha| chowk| near\s+\w+)/gi;
const NAME_TITLE_REGEX = /\b(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*\b/g;

const DEFAULT_OPTIONS: PiiFilterOptions = {
  maskPhone: true,
  maskName: true,
  maskEmail: true,
  maskAddress: true,
  maskCnic: true,
};

export function filterPii(text: string, options: PiiFilterOptions = DEFAULT_OPTIONS): string {
  let result = text;

  if (options.maskPhone) {
    result = result.replace(PHONE_REGEX, (match) => {
      const visible = match.replace(/[-\s]/g, "");
      if (visible.length >= 10) {
        return visible.slice(0, 4) + "******" + visible.slice(-2);
      }
      return "*** masked ***";
    });
  }

  if (options.maskCnic) {
    result = result.replace(CNIC_REGEX, "*****-*******-*");
  }

  if (options.maskEmail) {
    result = result.replace(EMAIL_REGEX, (match) => {
      const [local] = match.split("@");
      return local.slice(0, 2) + "***@***." + match.split(".").pop();
    });
  }

  if (options.maskName) {
    result = result.replace(NAME_TITLE_REGEX, (match) => {
      const title = match.split(/\s+/)[0];
      return `${title} ***`;
    });
  }

  if (options.maskAddress) {
    result = result.replace(ADDRESS_REGEX, " [address masked] ");
    result = result.replace(/\b(\d{1,4})\s+(.+?)\s+(road|street|avenue|lane|drive|boulevard)\b/gi, " [address masked] ");
  }

  return result;
}

export interface LogEntry {
  level: "info" | "warn" | "error";
  action: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

const MAX_LOG_ENTRIES = 500;
const log: LogEntry[] = [];

export function logPiiSafe(level: LogEntry["level"], action: string, msg: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    action,
    message: filterPii(msg),
    metadata: meta ? maskMetadata(meta) : undefined,
    timestamp: new Date().toISOString(),
  };
  log.push(entry);
  if (log.length > MAX_LOG_ENTRIES) {
    log.splice(0, log.length - MAX_LOG_ENTRIES);
  }
  const prefix = level === "error" ? "[ERROR]" : level === "warn" ? "[WARN]" : "[INFO]";
  console.log(`${prefix} [${action}] ${entry.message}`);
}

function maskMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  const sensitiveKeys = ["phone", "email", "address", "cnic", "password", "token", "secret", "authorization"];
  for (const [key, value] of Object.entries(meta)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
      masked[key] = "*** masked ***";
    } else if (typeof value === "string") {
      masked[key] = filterPii(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

export function getRecentLogs(count: number = 50): LogEntry[] {
  return log.slice(-count);
}

export function filterResponse(text: string): string {
  return filterPii(text);
}
