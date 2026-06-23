export const isValidUuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const emptyToNull = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};

export const normalizeOptionalUuid = (value: unknown) => {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  return isValidUuid(normalized) ? normalized : null;
};

export const safeNumber = (value: unknown) => {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

export const safeTextOrNull = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const requireNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0;
