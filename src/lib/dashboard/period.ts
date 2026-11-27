import { calendarDateOf } from "@/lib/regional/dates";

export type DashboardPeriod = "today" | "week" | "month" | "custom";
export type DashboardRange = { start: string; end: string };

export function dashboardRange(period: DashboardPeriod, today: string, custom: DashboardRange): DashboardRange | null {
  if (period === "custom") {
    return calendarDateOf(custom.start) === custom.start && calendarDateOf(custom.end) === custom.end && custom.start <= custom.end
      ? custom : null;
  }
  if (period === "month") return { start: today.slice(0, 8) + "01", end: today };
  if (period === "week") {
    const start = new Date(today + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - 6);
    return { start: start.toISOString().slice(0, 10), end: today };
  }
  return { start: today, end: today };
}

export function inDashboardRange(day: string | null, range: DashboardRange) {
  return day !== null && day >= range.start && day <= range.end;
}

export function activityDay(timestamp: string, timeZone: string | null) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? undefined, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}
