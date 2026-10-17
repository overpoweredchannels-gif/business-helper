export function formatAvailableStock(value: unknown): string {
  const stock = Number(value ?? 0);
  return Number.isFinite(stock) ? String(stock) : "0";
}
