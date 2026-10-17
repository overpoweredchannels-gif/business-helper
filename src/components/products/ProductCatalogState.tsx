import type { DashboardReadStatus } from "@/lib/dashboard/data-read-state";

/**
 * Compact failure banner with retry, shown wherever products are selectable
 * (products section, Retail POS, invoice lines) when a catalog refresh fails.
 *
 * A same-account transient failure keeps previously loaded rows visible and
 * selectable — entered drafts are preserved — but the failure must never be
 * silent, hence the prominent banner. Account/organization switches and logout
 * clear the catalog and selections outright instead (see clearDashboardSourceData
 * in src/app/page.tsx).
 */
export function ProductCatalogErrorBanner({
  onRetry,
  hasStaleData,
}: {
  onRetry: () => void;
  hasStaleData: boolean;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive-bg p-3">
      <p className="text-sm text-destructive">
        {hasStaleData
          ? "Couldn't refresh the product catalog. Showing previously loaded products."
          : "Couldn't load the product catalog. Check your connection and try again."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded border border-border bg-card px-3 py-2 text-sm text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Distinct UI states for the product catalog list, driven by the shared
 * dashboard read-state contract:
 * - "loading" / "not-loaded": the catalog is being fetched (or no fetch has
 *   started yet for the current account/organization).
 * - "failed": the refresh failed. The caller renders the banner above the
 *   retained rows; this component renders the banner when no rows match, so
 *   the warning is never duplicated and never silent. Retained rows stay
 *   visible and selectable, so drafts and selections survive a same-account
 *   transient failure.
 * - "successful-empty": the organization genuinely has no products.
 * - "successful-populated": the query matched nothing (caller shows the list
 *   otherwise; this component then renders nothing).
 */
export function ProductCatalogState({
  status,
  searchQuery,
  matchCount,
  hasProducts,
  onRetry,
}: {
  status: DashboardReadStatus;
  searchQuery: string;
  matchCount: number;
  hasProducts: boolean;
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
    return <ProductCatalogErrorBanner onRetry={onRetry} hasStaleData={hasProducts} />;
  }

  if (status === "successful-empty") {
    return <p className="text-sm text-muted-foreground">No products added yet.</p>;
  }

  const trimmed = searchQuery.trim();
  if (matchCount === 0 && trimmed) {
    return <p className="text-sm text-muted-foreground">No products match &ldquo;{trimmed}&rdquo;.</p>;
  }

  return null;
}
