/** Escape SQL ILIKE metacharacters when the whole search is an exact code. */
export function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Keep an exact SKU visible on the first API page, even when name ordering
 * would otherwise place it on a later page. The offset still tracks the raw
 * server page so pinning never skips catalog rows. */
export function pinExactSkuFirstPage<T extends { id: string }>(
  page: readonly T[],
  exactSku: T | null | undefined,
  offset: number,
): T[] {
  if (offset !== 0 || !exactSku) return [...page];
  return [exactSku, ...page.filter((product) => product.id !== exactSku.id)];
}
