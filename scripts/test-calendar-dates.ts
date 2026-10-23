// BUG 4 fixture suite: stored calendar dates must render as the exact
// stored day in every browser timezone, while true instants keep local
// rendering, and day-grouping derives from the stored calendar date.
//
// The pre-fix formatDate did `new Date("2026-10-22")` — parsed as UTC
// midnight — so in America/New_York it rendered "21-Oct-2026". These
// cases pin the fixed behaviour per timezone (process.env.TZ is mutated
// per case; Node applies it to Date and Intl at runtime).
import assert from "node:assert/strict";
import { calendarDateOf, calendarDayOfRecord, formatCalendarDate } from "../src/lib/regional/dates";
import { formatDate } from "../src/lib/tradeos/formatters";

const TIMEZONES = ["UTC", "America/New_York", "Asia/Karachi", "Pacific/Kiritimati"] as const;

// [stored date, expected en-PK render] — month/year boundaries + leap day.
const CALENDAR_CASES: Array<[string, string]> = [
  ["2026-10-22", "22-Oct-2026"],
  ["2026-11-01", "01-Nov-2026"],
  ["2026-12-31", "31-Dec-2026"],
  ["2027-01-01", "01-Jan-2027"],
  ["2024-02-29", "29-Feb-2024"],
];

for (const timeZone of TIMEZONES) {
  process.env.TZ = timeZone;
  for (const [stored, expected] of CALENDAR_CASES) {
    assert.equal(
      formatCalendarDate(stored, "en-PK"),
      expected,
      `${timeZone}: formatCalendarDate(${stored}) must render the stored day`,
    );
    assert.equal(
      formatDate(stored),
      expected,
      `${timeZone}: formatDate(${stored}) must route date-only values through the calendar formatter`,
    );
  }
  // A date-only string never shifts, in either direction.
  assert.equal(formatDate("2026-10-22"), "22-Oct-2026", `${timeZone}: 2026-10-22 stays the 22nd`);
}

// Invalid calendar days are rejected, never rolled into a neighbouring month.
assert.throws(() => formatCalendarDate("2026-02-30", "en-PK"));
assert.equal(formatDate("2026-02-30"), "-", "formatDate keeps its '-' sentinel for invalid date-only values");
assert.equal(formatDate(""), "-");
assert.equal(formatDate(null), "-");

// True instants are NOT pinned: formatDate keeps rendering them in the
// browser's local timezone (created_at displayed as a timestamp is
// legitimately local). 2026-10-22T23:30Z is Oct 22 in New York and
// Oct 23 in Kiritimati.
process.env.TZ = "America/New_York";
assert.equal(formatDate("2026-10-22T23:30:00.000Z"), "22-Oct-2026", "instant renders locally (New York)");
process.env.TZ = "Pacific/Kiritimati";
assert.equal(formatDate("2026-10-22T23:30:00.000Z"), "23-Oct-2026", "instant renders locally (Kiritimati)");

// calendarDateOf: extraction + validation.
assert.equal(calendarDateOf("2026-10-22"), "2026-10-22");
assert.equal(calendarDateOf("2026-10-22T23:30:00.000Z"), "2026-10-22", "timestamp reduces to its recorded date part");
assert.equal(calendarDateOf(" 2026-10-22 "), "2026-10-22");
assert.equal(calendarDateOf("2026-02-30"), null, "impossible days are rejected");
assert.equal(calendarDateOf("not-a-date"), null);
assert.equal(calendarDateOf(null), null);
assert.equal(calendarDateOf(undefined), null);
assert.equal(calendarDateOf(20261022), null);

// Receipt reduction (BUG 4 item d): a timestamp-shaped sale_date prints
// its recorded day even in a western timezone, where rendering the raw
// instant would print the previous day (01:30Z = 21:30 in New York).
process.env.TZ = "America/New_York";
const receiptDay = calendarDateOf("2026-10-22T01:30:00.000Z");
assert.equal(receiptDay, "2026-10-22");
assert.equal(formatDate(receiptDay), "22-Oct-2026", "receipt prints the recorded day, not the instant's local day");

// Day-grouping rule ("Today's Sales"): the stored calendar date decides;
// the creation instant is only a fallback for records that have none.
const sale = { sale_date: "2026-10-22", created_at: "2026-10-21T23:30:00.000Z" }; // created D-1 (UTC)
assert.equal(calendarDayOfRecord([sale.sale_date, sale.created_at]), "2026-10-22", "groups under sale_date, not the D-1 creation day");
const saleNextDay = { sale_date: "2026-10-22", created_at: "2026-10-23T00:30:00.000Z" }; // created D+1 (UTC)
assert.equal(calendarDayOfRecord([saleNextDay.sale_date, saleNextDay.created_at]), "2026-10-22", "groups under sale_date, not the D+1 creation day");
assert.equal(
  calendarDayOfRecord([null, "2026-10-21T23:30:00.000Z"]),
  "2026-10-21",
  "records with no calendar date keep the creation-day fallback",
);
assert.equal(calendarDayOfRecord([undefined, undefined]), null);
assert.equal(calendarDayOfRecord(["2026-02-30", "2026-10-21T23:30:00.000Z"]), "2026-10-21", "an invalid stored date falls back instead of grouping under a phantom day");

process.env.TZ = "UTC";
console.log("test-calendar-dates: all assertions passed");
