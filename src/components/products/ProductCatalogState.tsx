import type { DashboardReadStatus } from "@/lib/dashboard/data-read-state";

/**
 * Distinct UI states for the product catalog list, driven by the shared
 * dashboard read-state contract:
 * - "loading" / "not-loaded": the catalog is being fetched (or no fetch has
 *   started yet for the current account/organization).
 * - "failed": the fetch failed — the list is hidden (fail-closed: invoice and
 *   POS flows must not silently use a stale catalog) and a retry is offered.
 *   Retry always targets the currently authorized organization via the
 *   caller's onRetry.
 * - "successful-empty": the organization genuinely has no products.
 * - "successful-populated": the query matched nothing.
 */
export function ProductCatalogState({
  status,
  searchQuery,
  onRetry,
}: {
  status: DashboardReadStatus;
  searchQuery: string;
  onRetry: () => void;
}) {
  if (status === "loading" || status === "not-loaded") {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Loading products...
      </p>
    );
  }

  if (status === "failed") {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the product catalog. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded border border-border px-3 py-2 text-sm text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      </div>
    );
  }

  const trimmed = searchQuery.trim();
  if (status === "successful-populated" && trimmed) {
    return <p className="text-sm text-muted-foreground">No products match &ldquo;{trimmed}&rdquo;.</p>;
  }

  return <p className="text-sm text-muted-foreground">No products added yet.</p>;
}
