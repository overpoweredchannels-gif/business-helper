"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Search } from "lucide-react";
import { rankSearchResults } from "@/lib/products/search-rank";

/** Product row shape returned by GET /api/products/list. */
export interface VisitProduct {
  id: string;
  name: string;
  sku?: string | null;
  unit_type?: string | null;
  current_stock: number;
  default_selling_price: number | null;
}

export interface VisitProductPage {
  products: VisitProduct[];
  nextOffset: number | null;
}

const SEARCH_DEBOUNCE_MS = 300;
export const VISIT_PRODUCT_SEARCH_PAGE_SIZE = 25;

function formatPrice(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/**
 * Paginated product lookup for field staff (visits).
 *
 * Uses the existing /api/products/list contract (search/offset/limit ->
 * products + nextOffset) instead of loading the catalog up front: each
 * keystroke searches server-side (tenant + permission filtered there) and
 * the returned page is re-ranked client-side with the shared ranking helper
 * so exact SKU matches come before name matches.
 *
 * Safety:
 * - `invalidationRef` is shared with the caller's scope guard: every new
 *   search bumps it, and the guard bumps it on logout/account-switch/unmount,
 *   so out-of-order or old-scope responses can never commit.
 * - A failed search keeps already-added draft items untouched (they live in
 *   the caller) and offers Retry for the same query.
 */
export function VisitProductLookup({
  searchProducts,
  onAddProduct,
  invalidationRef,
}: {
  searchProducts: (query: string, offset: number) => Promise<VisitProductPage>;
  onAddProduct: (product: VisitProduct) => void;
  invalidationRef: { current: number };
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VisitProduct[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "loading-more" | "failed" | "done">("idle");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listId = useId();

  const runSearch = useCallback(
    async (searchText: string, offset: number, append: boolean) => {
      const requestId = ++invalidationRef.current;
      setStatus(append ? "loading-more" : "loading");
      if (!append) setError(null);
      try {
        const page = await searchProducts(searchText, offset);
        if (requestId !== invalidationRef.current) return; // stale: query changed, logout, or account switch
        setResults((prev) => {
          const seen = new Set(append ? prev.map((p) => p.id) : []);
          const combined = append ? [...prev] : [];
          for (const p of page.products) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            combined.push(p);
          }
          // Exact SKU matches first, then relevant name matches.
          return rankSearchResults(combined, searchText, (p) => ({
            name: p.name,
            sku: p.sku ?? undefined,
          }));
        });
        setNextOffset(page.nextOffset);
        setStatus("done");
        setActiveIndex(null);
      } catch (err) {
        if (requestId !== invalidationRef.current) return;
        if (!append) setResults([]);
        setError(err instanceof Error ? err.message : "Search failed. Please try again.");
        setStatus("failed");
      }
    },
    [invalidationRef, searchProducts],
  );

  // Debounced search-as-you-type. Clearing the input hides results (the render
  // gates everything on a non-empty query) and invalidates any in-flight
  // request; the next search resets state when it runs.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      invalidationRef.current += 1;
      return;
    }
    const timer = window.setTimeout(() => {
      void runSearch(trimmed, 0, false);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, invalidationRef, runSearch]);

  const retry = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed) void runSearch(trimmed, 0, false);
  }, [query, runSearch]);

  const loadMore = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed && nextOffset != null && status === "done") void runSearch(trimmed, nextOffset, true);
  }, [query, nextOffset, status, runSearch]);

  const choose = useCallback(
    (product: VisitProduct) => {
      onAddProduct(product);
    },
    [onAddProduct],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setActiveIndex((prev) => {
        const next = prev == null ? (event.key === "ArrowDown" ? 0 : results.length - 1) : prev + (event.key === "ArrowDown" ? 1 : -1);
        return Math.max(0, Math.min(next, results.length - 1));
      });
    } else if (event.key === "Enter") {
      if (activeIndex != null && results[activeIndex]) {
        event.preventDefault();
        choose(results[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setQuery("");
    }
  };

  const showResults = query.trim().length > 0;

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search products by name or SKU..."
          role="combobox"
          aria-expanded={showResults && results.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeIndex != null && results[activeIndex] ? `${listId}-option-${results[activeIndex].id}` : undefined}
          className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 pl-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 min-h-11 min-w-11 -translate-y-1/2 rounded-md px-2 text-lg leading-none text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ×
          </button>
        )}
      </div>

      {showResults && (
        <div className="mb-4">
          {(status === "loading" || status === "loading-more") && (
            <p role="status" aria-live="polite" className="px-1 py-2 text-sm text-muted-foreground">
              {status === "loading" ? "Searching products..." : "Loading more..."}
            </p>
          )}

          {status === "failed" && (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive-bg p-3">
              <p className="text-sm text-destructive">Couldn&apos;t search products. {error}</p>
              <button
                type="button"
                onClick={retry}
                className="min-h-11 rounded border border-border bg-card px-3 py-2 text-sm text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            </div>
          )}

          {status === "done" && results.length === 0 && (
            <p className="px-1 py-2 text-sm text-muted-foreground">No products found for &ldquo;{query.trim()}&rdquo;.</p>
          )}

          {results.length > 0 && (
            <div id={listId} role="listbox" aria-label="Product results" className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {results.map((p, index) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  id={`${listId}-option-${p.id}`}
                  aria-selected={index === activeIndex}
                  data-testid={`visit-result-${p.id}`}
                  onClick={() => choose(p)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                    index === activeIndex ? "bg-muted" : "hover:bg-muted/40"
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.sku ? `SKU: ${p.sku} · ` : ""}Stock: {p.current_stock}
                      {p.unit_type ? ` · ${p.unit_type}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-foreground" data-testid={`visit-price-${p.id}`}>
                    {formatPrice(p.default_selling_price)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {status === "done" && nextOffset != null && (
            <button
              type="button"
              onClick={loadMore}
              className="mt-2 min-h-11 w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
