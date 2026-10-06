"use client";

import { useLayoutEffect, useRef } from "react";
import { highlightSearchMatches } from "@/lib/products/search-rank";

export interface SuggestionPopoverItem {
  id: string;
  label: string;
  /** Secondary line, e.g. "SKU-001 · Rs 120" or "Shop name · 0300…". Plain text only. */
  detail?: string;
  icon?: React.ReactNode;
}

export type SuggestionStatus = "ready" | "loading" | "error";

export interface SuggestionFooter {
  /** Optional leading text, e.g. "Showing 8 of 25 matches". */
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * A source-level status shown independently of the suggestion list itself,
 * e.g. "Loading products…" while local section results are already visible.
 */
export interface SuggestionStatusNote {
  text: string;
  variant: "info" | "error";
}

interface SuggestionPopoverProps {
  /** id referenced by the combobox input's aria-controls. */
  listId: string;
  ariaLabel: string;
  placement: "above" | "below";
  maxHeightPx: number;
  items: SuggestionPopoverItem[];
  /** Index into items of the keyboard/mouse-highlighted option. */
  activeIndex: number;
  /** Raw query, used only for safe text highlighting (never rendered as HTML). */
  query: string;
  status: SuggestionStatus;
  emptyText?: string;
  loadingText?: string;
  /** Shown instead of the list when the initial read failed and there is nothing to show. */
  errorText?: string;
  /** Slim note shown above stale results when a refresh failed. */
  staleText?: string;
  /**
   * Independent source status (e.g. the product source loading/failing while
   * local results are shown). Rendered above the list; when there is nothing
   * to list, it replaces "No matches" so a failed source is never reported
   * as an empty result set.
   */
  statusNote?: SuggestionStatusNote;
  /** Explicit result-limit footer ("Showing 8 of 25" + action), outside the listbox. */
  footer?: SuggestionFooter;
  onSelect: (id: string) => void;
  onHover: (index: number) => void;
}

/**
 * Consistent, compact autocomplete suggestion panel rendered directly below
 * (or above, when viewport space demands it) the search field. All text is
 * rendered as plain segments — user input is never injected as HTML.
 */
export function SuggestionPopover({
  listId,
  ariaLabel,
  placement,
  maxHeightPx,
  items,
  activeIndex,
  query,
  status,
  emptyText = "No matches found.",
  loadingText = "Loading…",
  errorText = "Couldn't load results.",
  staleText = "Couldn't refresh — showing saved results.",
  statusNote,
  footer,
  onSelect,
  onHover,
}: SuggestionPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Keep the active option visible by scrolling the popover's own scroll
    // container only. Element.scrollIntoView would also scroll the page
    // itself, visibly jumping the user's scroll position when the panel opens.
    const popover = popoverRef.current;
    const active = document.getElementById(`${listId}-${activeIndex}`);
    if (!popover || !active) return;
    const popRect = popover.getBoundingClientRect();
    const optRect = active.getBoundingClientRect();
    if (optRect.top < popRect.top) {
      popover.scrollTop -= popRect.top - optRect.top;
    } else if (optRect.bottom > popRect.bottom) {
      popover.scrollTop += optRect.bottom - popRect.bottom;
    }
  }, [activeIndex, listId]);

  // Distinguish the four read states: initial load, successful results
  // (possibly mid-refresh), initial failure with nothing to show, and stale
  // results after a refresh failure.
  const showLoading = status === "loading" && items.length === 0;
  const showError = status === "error" && items.length === 0;

  return (
    <div
      ref={popoverRef}
      className={`absolute left-0 right-0 z-50 overflow-y-auto rounded border border-border bg-card shadow-lg ${
        placement === "below" ? "top-full mt-1" : "bottom-full mb-1"
      }`}
      style={{ maxHeight: maxHeightPx }}
    >
      {showLoading ? (
        <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
          {loadingText}
        </p>
      ) : showError ? (
        <p role="status" className="px-3 py-3 text-sm text-destructive">
          {errorText}
        </p>
      ) : (
        <>
          {statusNote && (
            <p
              role="status"
              className={`border-b border-border px-3 py-2 text-xs ${
                statusNote.variant === "error" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {statusNote.text}
            </p>
          )}
          {status === "error" && items.length > 0 && !statusNote && (
            <p role="status" className="border-b border-border px-3 py-2 text-xs text-warning">
              {staleText}
            </p>
          )}
          {items.length > 0 ? (
            <ul id={listId} role="listbox" aria-label={ariaLabel}>
              {items.map((item, index) => (
                <li
                  key={item.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-suggestion-id={item.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onSelect(item.id)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                    index === activeIndex ? "bg-primary/10 text-primary" : "text-foreground"
                  }`}
                >
                  {item.icon}
                  <span className="min-w-0">
                    <span className="block truncate">
                      {highlightSearchMatches(item.label, query).map((segment, segmentIndex) =>
                        segment.match ? (
                          <mark key={segmentIndex} className="rounded-sm bg-primary/10 px-px text-inherit">
                            {segment.text}
                          </mark>
                        ) : (
                          <span key={segmentIndex}>{segment.text}</span>
                        ),
                      )}
                    </span>
                    {item.detail && (
                      <span className="block truncate text-xs text-muted-foreground/80">{item.detail}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : statusNote ? null : (
            <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
              {emptyText}
            </p>
          )}
          {footer && (footer.text || (footer.actionLabel && footer.onAction)) && (
            <div className="border-t border-border">
              {footer.actionLabel && footer.onAction ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={footer.onAction}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {footer.text ? (
                    <span>
                      {footer.text} — <span className="underline">{footer.actionLabel}</span>
                    </span>
                  ) : (
                    <span className="underline">{footer.actionLabel}</span>
                  )}
                </button>
              ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">{footer.text}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
