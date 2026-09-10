export function reportRange(from: string, to: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw new Error("Choose a valid start and end date");
  // Business-day boundaries in Pakistan, not the web server's timezone.
  const start = new Date(`${from}T00:00:00+05:00`);
  const end = new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 86400000);
  return { from, to, start: start.toISOString(), end: end.toISOString() };
}
export type ReportSection = { title: string; columns: string[]; rows: Record<string, unknown>[] };
export function businessReportHtml(from: string, to: string, sections: ReportSection[]) {
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Business records ${escape(from)} to ${escape(to)}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#111}h1{font-size:22px}h2{margin-top:24px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #bbb;padding:5px;overflow-wrap:anywhere;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}.controls{padding:15px;background:#eee}@media print{.controls{display:none}}</style></head><body><div class="controls"><button onclick="window.print()">Print / Save as PDF</button> Choose “Save as PDF” in the print destination.</div><h1>TradeOS business records</h1><p>${escape(from)} through ${escape(to)} inclusive · Pakistan time · Generated ${escape(new Date().toISOString())}</p><p>Transactions use their business dates; activity and new records use their recorded timestamps. Viewing a dashboard is not logged unless an activity event exists. This report does not delete records and is not a database backup.</p>${sections.map(section => `<h2>${escape(section.title)} (${section.rows.length})</h2>${section.rows.length ? `<table><thead><tr>${section.columns.map(column => `<th>${escape(column.replace(/_/g, " "))}</th>`).join("")}</tr></thead><tbody>${section.rows.map(row => `<tr>${section.columns.map(column => `<td>${escape(row[column])}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "<p>No records in this range.</p>"}`).join("")}</body></html>`;
}
