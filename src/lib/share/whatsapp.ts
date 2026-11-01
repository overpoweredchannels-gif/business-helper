/**
 * Free WhatsApp sharing via wa.me links (no Business API, no per-message
 * cost, no account approval). The link opens the shopkeeper's own WhatsApp
 * with a prefilled message; nothing is ever sent automatically.
 *
 * Number rule — honest on purpose: wa.me needs a full international
 * number, and this app stores no org country to guess one from. So only
 * numbers that already carry their country code are linkable: a leading
 * "+" (or "00", the same thing typed differently). A local number starting
 * with a trunk "0" returns null, and the UI says so instead of building
 * a link that would open the wrong chat.
 */
export function parseWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[\s\-()]/g, "");
  if (!cleaned) return null;
  let digits = cleaned;
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else return null;
  if (!/^\d{7,15}$/.test(digits)) return null;
  return digits;
}

export function buildWhatsAppLink(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Fill a {placeholder} template. Unknown placeholders are left as-is. */
export function fillWhatsAppTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** First linkable number wins: the WhatsApp field, else the phone field. */
export function firstWhatsAppLink(
  whatsapp: string | null | undefined,
  phone: string | null | undefined,
  text: string,
): string | null {
  const digits = parseWhatsAppNumber(whatsapp) ?? parseWhatsAppNumber(phone);
  if (!digits) return null;
  return buildWhatsAppLink(digits, text);
}
