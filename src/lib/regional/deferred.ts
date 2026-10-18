import type { MessageKey } from './messages';

/**
 * An application-owned message stored as a catalog key plus interpolation
 * values instead of a translated string. Components store this in state and
 * translate at render time, so messages always reflect the *current* language —
 * even if the language was switched after the operation that produced them.
 *
 * Raw server/network messages stay as plain strings and are never translated.
 */
export interface DeferredMessage {
  key: MessageKey;
  values?: Record<string, string | number>;
}

/** Translate a DeferredMessage with the current `t`, applying `{name}` interpolation. */
export function renderDeferred(t: (key: MessageKey) => string, message: DeferredMessage): string {
  let text = t(message.key);
  if (message.values) {
    for (const [name, value] of Object.entries(message.values)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** True when the value is a DeferredMessage (vs a raw server/network string). */
export function isDeferredMessage(value: unknown): value is DeferredMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof (value as { key: unknown }).key === 'string'
  );
}
