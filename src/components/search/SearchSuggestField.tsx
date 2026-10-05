"use client";

import { useId, useMemo, useState } from "react";
import { activeSuggestionIndex } from "@/components/invoices/search-selection";
import { rankSearchResults, type SearchRankFields } from "@/lib/products/search-rank";
import { SuggestionPopover, type SuggestionStatus } from "./SuggestionPopover";
import type { SuggestionItem } from "./suggestion-items";
import { useSuggestionPlacement } from "./useSuggestionPlacement";

interface SearchSuggestFieldProps {
  label: string;
  placeholder?: string;
  /** Current filter text, owned by the parent (it also filters the list below). */
  value: string;
  onChange: (value: string) => void;
  /** Already-authorized items; tenant/role/permission filtering stays with the caller. */
  items: SuggestionItem[];
  /** Prebuilt id → structured rank fields. Omit only for lists without structured fields. */
  rankedFields?: Map<string, SearchRankFields>;
  maxSuggestions?: number;
  /** Server-backed lists report loading/failure; client lists stay "ready". */
  status?: SuggestionStatus;
  inputClassName?: string;
  /** Wrapper div classes (the popover anchors to it). Defaults to full width. */
  className?: string;
  listAriaLabel?: string;
  emptyText?: string;
}

/**
 * Autocomplete suggestion panel for plain filter fields (e.g. the Products
 * and Customers section search boxes). Typing shows the top relevance-ranked
 * matches directly below the field so users never have to scroll the page to
 * find a record. Selecting a suggestion commits its exact name to the filter,
 * which puts that record first in the already-ranked list below.
 */
export function SearchSuggestField({
  label,
  placeholder,
  value,
  onChange,
  items,
  rankedFields,
  maxSuggestions = 8,
  status = "ready",
  inputClassName = "w-full rounded border border-border px-3 py-2 focus:border-ring focus:outline-none",
  className = "relative min-w-0 w-full",
  listAriaLabel,
  emptyText,
}: SearchSuggestFieldProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const query = value.trim();
  const showPopover = open && query.length > 0;

  const matches = useMemo(() => {
    if (!query) return [];
    const ranked = rankedFields
      ? rankSearchResults(items, query, (item) => rankedFields.get(item.id) ?? { name: item.label })
      : items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
    return ranked.slice(0, maxSuggestions);
  }, [items, query, rankedFields, maxSuggestions]);

  const activeIndex = activeSuggestionIndex(matches, "", active);
  const { anchorRef, placement, maxHeightPx } = useSuggestionPlacement(showPopover);

  const select = (id: string) => {
    const item = matches.find((match) => match.id === id);
    if (!item) return;
    onChange(item.label);
    setOpen(false);
    setActive(null);
  };

  return (
    <div ref={anchorRef} className={className}>
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showPopover}
        aria-controls={listId}
        aria-activedescendant={showPopover && matches.length ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onFocus={() => {
          if (query) {
            setActive(0);
            setOpen(true);
          }
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            setActive(showPopover ? activeSuggestionIndex(matches, "", activeIndex + direction) : 0);
            setOpen(true);
          } else if (event.key === "Enter") {
            if (showPopover) {
              event.preventDefault();
              if (matches[activeIndex]) select(matches[activeIndex].id);
              else setOpen(false);
            }
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
        className={inputClassName}
      />
      {showPopover && (
        <SuggestionPopover
          listId={listId}
          ariaLabel={listAriaLabel ?? `${label} suggestions`}
          placement={placement}
          maxHeightPx={maxHeightPx}
          items={matches}
          activeIndex={activeIndex}
          query={query}
          status={status}
          emptyText={emptyText}
          onSelect={select}
          onHover={setActive}
        />
      )}
    </div>
  );
}
