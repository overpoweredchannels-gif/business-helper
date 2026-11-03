import { DEFAULT_DIAL_CODE, DIAL_CODES } from "@/lib/regional/dial-codes";

/** Split a stored phone value into its dial code and national part.
 * - Empty value: the form default code, so a new number starts international.
 * - `+<code>...`: the longest matching dial code wins (so +1242 beats +1).
 * - Anything else (local numbers such as 0300...): no code selected, the
 *   value is kept exactly as stored until the user picks a code. */
function splitPhone(value: string): { code: string; national: string } {
  if (!value) return { code: DEFAULT_DIAL_CODE, national: "" };
  if (value.startsWith("+")) {
    const digits = value.slice(1);
    let best = "";
    for (const entry of DIAL_CODES) {
      if (digits.startsWith(entry.code) && entry.code.length > best.length) best = entry.code;
    }
    if (best) return { code: best, national: digits.slice(best.length) };
    return { code: "", national: value };
  }
  return { code: "", national: value };
}

/** Join a code and a national part back into one stored value.
 * - No national part: empty (a bare code is never stored).
 * - No code: the national part unchanged (local numbers stay local).
 * - With a code: `+<code><national>` with one leading trunk `0` dropped,
 *   the standard international form (0300... + 92 = +92300...). */
function joinPhone(code: string, national: string): string {
  if (!national) return "";
  if (!code) return national;
  return `+${code}${national.replace(/^0/, "")}`;
}

/** A phone/WhatsApp field with a country-code picker in front of it.
 * The stored value stays one string (the same `phone`/`whatsapp` field the
 * save path already sends), so nothing downstream changes. The picker sits
 * in the Enter chain: Enter on the code select moves to the number, Enter
 * on the number moves to the next field, exactly like the other fields. */
export function PhoneWithCode({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { code, national } = splitPhone(value);
  return (
    <label className="flex flex-col gap-2 text-sm text-foreground/80">
      <span>{label}</span>
      <span className="flex gap-2">
        <select
          aria-label={`${label} country code`}
          value={code}
          onChange={(e) => onChange(joinPhone(e.target.value, national))}
          className="rounded border border-border px-2 py-2 focus:border-ring focus:outline-none"
        >
          <option value="">Code</option>
          {DIAL_CODES.map((entry) => (
            <option key={`${entry.code}-${entry.country}`} value={entry.code}>
              {entry.country} (+{entry.code})
            </option>
          ))}
        </select>
        <input
          type="tel"
          value={national}
          onChange={(e) => onChange(joinPhone(code, e.target.value))}
          className="w-full rounded border border-border px-3 py-2 focus:border-ring focus:outline-none"
        />
      </span>
    </label>
  );
}
