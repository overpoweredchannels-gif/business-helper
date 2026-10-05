"use client";

import { useLayoutEffect } from "react";
import { highlightSearchMatches } from "@/lib/products/search-rank";

export interface SuggestionPopoverItem {
  id: string;
  label: string;
  /** Secondary line, e.g. "SKU-001 · Rs 120" or "Shop name · 0300…". Plain text only. */
  detail?: string;
  icon?: React.ReactNode;
}

export type SuggestionStatus = "ready" | "loading" | "error";

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
  /** Slim note shown above stale results when a refresh failed. */
  staleText?: string;
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
  staleText = "Couldn't refresh — showing saved results.",
  onSelect,
  onHover,
}: SuggestionPopoverProps) {
  useLayoutEffect(() => {
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId]);

  return (
    <div
      className={`absolute left-0 right-0 z-50 overflow-y-auto rounded border border-border bg-card shadow-lg ${
        placement === "below" ? "top-full mt-1" : "bottom-full mb-1"
      }`}
      style={{ maxHeight: maxHeightPx }}
    >
      {status === "loading" ? (
        <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
          {loadingText}
        </p>
      ) : (
        <>
          {status === "error" && items.length > 0 && (
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
          ) : (
            <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
              {emptyText}
            </p>
          )}
        </>
      )}
    </div>
  );
}
