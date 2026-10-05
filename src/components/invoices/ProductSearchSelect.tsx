"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { focusNextEntryField } from "./entry-navigation";
import { activeSuggestionIndex } from "./search-selection";
import { highlightSearchMatches, rankSearchResults, type SearchRankFields } from "@/lib/products/search-rank";
import { useSuggestionPlacement } from "@/components/search/useSuggestionPlacement";

export function ProductSearchSelect({ value, onChange, products, label = "Product", searchPlaceholder = "Search name, brand or SKU", rankedFields, maxSuggestions = 12 }: {
  value: string;
  onChange: (value: string) => void;
  products: Array<{ id: string; label: string }>;
  label?: string;
  searchPlaceholder?: string;
  /** Prebuilt id → structured rank fields, built by the caller in one pass and
   * memoized. When provided, suggestions are relevance-ranked with the shared
   * search contract (O(1) field lookup per candidate). Used for products and
   * for customers (shop name ranks as the code field, phone second, contact
   * person and city lowest). Omit only for lists without structured fields,
   * which keep the legacy label filter. */
  rankedFields?: Map<string, SearchRankFields>;
  /** Maximum options rendered in the popover; the ranking itself still scores
   * every candidate, so the top matches are always the most relevant ones. */
  maxSuggestions?: number;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const selected = products.find(product => product.id === value);
  const matches = useMemo(() => {
    const ranked = !rankedFields
      ? (() => {
          const terms = (query ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
          return products.filter(product => terms.every(term => product.label.toLocaleLowerCase().includes(term)));
        })()
      : rankSearchResults(products, query ?? "", (product) => rankedFields.get(product.id) ?? { name: product.label });
    return ranked.slice(0, maxSuggestions);
  }, [products, query, rankedFields, maxSuggestions]);
  const activeIndex = activeSuggestionIndex(matches, value, active);
  const { anchorRef, placement, maxHeightPx } = useSuggestionPlacement(open);
  useLayoutEffect(() => {
    input.current?.setCustomValidity(selected ? "" : `Choose a ${label.toLowerCase()} from the suggestions.`);
  }, [selected, label]);
  useLayoutEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, listId]);

  const choose = (id: string) => {
    onChange(id);
    setQuery(null);
    setOpen(false);
    setActive(null);
    requestAnimationFrame(() => {
      if (input.current && document.activeElement === input.current) focusNextEntryField(input.current);
    });
  };

  return <div ref={anchorRef} className="relative min-w-0">
    <input ref={input} type="text" role="combobox" aria-label={label} aria-autocomplete="list"
      aria-expanded={open} aria-controls={listId} aria-activedescendant={open && matches.length ? `${listId}-${activeIndex}` : undefined}
      autoComplete="off" required placeholder={searchPlaceholder} value={query ?? selected?.label ?? ""}
      onFocus={() => { setActive(null); setOpen(true); }} onBlur={() => setOpen(false)}
      onChange={event => { setQuery(event.target.value); setOpen(true); setActive(0); if (value) onChange(""); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopPropagation();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          setActive(open ? activeSuggestionIndex(matches, value, activeIndex + direction) : null);
          setOpen(true);
        } else if (event.key === "Enter" && !event.shiftKey && open) {
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat && matches[activeIndex]) choose(matches[activeIndex].id);
          else input.current?.reportValidity();
        } else if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); setOpen(false);
        }
      }} className="w-full rounded border border-input px-3 py-2 focus:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    {open && <div className={`absolute left-0 right-0 z-50 overflow-y-auto rounded border border-border bg-card shadow-lg ${placement === "below" ? "top-full mt-1" : "bottom-full mb-1"}`} style={{ maxHeight: maxHeightPx }}>
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
        {matches.map((product, index) => <li key={product.id} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
          data-suggestion-id={product.id}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(product.id)}
          className={`flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm ${index === activeIndex ? "bg-primary/10 text-primary" : "text-foreground"}`}>
          {highlightSearchMatches(product.label, query ?? "").map((segment, segmentIndex) =>
            segment.match ? (
              <mark key={segmentIndex} className="rounded-sm bg-primary/10 px-px text-inherit">{segment.text}</mark>
            ) : (
              <span key={segmentIndex}>{segment.text}</span>
            ),
          )}
        </li>)}
      </ul>
      {!matches.length && <p role="status" className="px-3 py-3 text-sm text-muted-foreground">No matches found. Try another name.</p>}
    </div>}
  </div>;
}
