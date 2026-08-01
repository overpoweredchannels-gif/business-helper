export interface SanitizeResult {
  ok: boolean;
  cleaned: string;
  error?: string;
}

const MAX_MESSAGE_LENGTH = 2000;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|above|below)\s+instructions/i,
  /forget\s+(all\s+)?(previous|above|below)\s+(instructions|context)/i,
  /you\s+are\s+(now|not\s+(required|allowed)\s+to)/i,
  /act\s+as\s+(if\s+you\s+are|though\s+you\s+are)/i,
  /system\s+(prompt|instruction|message)/i,
  /do\s+not\s+(follow|obey|adhere\s+to)/i,
  /you\s+must\s+ignore/i,
  /new\s+(instructions|prompt|directives?)/i,
  /override\s+(instructions|prompt|system)/i,
  /disregard\s+(all\s+)?(previous|above)/i,
];

export function sanitizeMessage(raw: string): SanitizeResult {
  if (typeof raw !== "string") {
    return { ok: false, cleaned: "", error: "Message must be a string." };
  }

  let cleaned = raw.trim();
  if (cleaned.length === 0) {
    return { ok: false, cleaned: "", error: "Message is required." };
  }
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    cleaned = cleaned.slice(0, MAX_MESSAGE_LENGTH);
  }

  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { ok: false, cleaned, error: "Message contains disallowed patterns." };
    }
  }

  return { ok: true, cleaned };
}

export function sanitizeHistory(
  history: Array<{ role: "user" | "assistant"; text: string }>
): Array<{ role: "user" | "assistant"; text: string }> {
  return history
    .filter((m) => typeof m.text === "string" && m.text.trim().length > 0)
    .slice(-10)
    .map((m) => ({
      role: m.role,
      text: m.text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, MAX_MESSAGE_LENGTH),
    }));
}
