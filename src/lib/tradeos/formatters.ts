import { safeNumber } from "./validators";

export const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getMonthRange = (monthOffset = 0) => {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0);
  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  };
};

export const getDateOnly = (dateValue: string | null | undefined) => {
  if (!dateValue) return null;
  return dateValue.slice(0, 10);
};

export const isDateInRange = (dateValue: string | null | undefined, startDate: string, endDate: string) => {
  const dateOnly = getDateOnly(dateValue);
  if (!dateOnly) return false;
  if (startDate && dateOnly < startDate) return false;
  if (endDate && dateOnly > endDate) return false;
  return true;
};

export const addDaysToDateInputValue = (dateValue: string, days: number) => {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
};

export const getUsableTimestamp = (...dateValues: Array<unknown>) => {
  for (const dateValue of dateValues) {
    if (typeof dateValue !== "string" || !dateValue.trim()) continue;
    const timestamp = new Date(dateValue).getTime();
    if (Number.isFinite(timestamp)) {
      return {
        value: dateValue,
        time: timestamp,
      };
    }
  }

  return {
    value: null,
    time: 0,
  };
};

export const formatPKR = (value: unknown) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2,
  }).format(safeNumber(value));

export const formatCurrency = formatPKR;

export const formatDate = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

export const formatDateTime = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("en-PK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatNumber = (value: unknown) =>
  new Intl.NumberFormat("en-PK", {
    maximumFractionDigits: 2,
  }).format(safeNumber(value));

export const formatPercent = (value: unknown) => `${formatNumber(value)}%`;

export const calculateDistanceMeters = (
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number
) => {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(secondLatitude - firstLatitude);
  const longitudeDelta = toRadians(secondLongitude - firstLongitude);
  const firstLatitudeRadians = toRadians(firstLatitude);
  const secondLatitudeRadians = toRadians(secondLatitude);
  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(firstLatitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
};

export const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const downloadCsv = (filename: string, rows: Array<Record<string, unknown>>) => {
  if (typeof window === "undefined" || typeof document === "undefined" || rows.length === 0) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const escapeCsvCell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""').replace(/\r?\n/g, "\n")}"`;
  };
  const csv = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(",")),
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
