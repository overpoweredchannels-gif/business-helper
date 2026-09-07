"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { focusNextEntryField } from "./entry-navigation";
import { activeSuggestionIndex } from "./search-selection";

export function ProductSearchSelect({ value, onChange, products, label = "Product", searchPlaceholder = "Search name, brand or SKU" }: {
  value: string;
  onChange: (value: string) => void;
  products: Array<{ id: string; label: string }>;
  label?: string;
  searchPlaceholder?: string;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const selected = products.find(product => product.id === value);
  const terms = (query ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = products.filter(product => terms.every(term => product.label.toLocaleLowerCase().includes(term)));
  const activeIndex = activeSuggestionIndex(matches, value, active);
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

  return <div className="relative min-w-0">
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
      }} className="w-full rounded border border-border px-3 py-2 focus:border-ring focus:outline-none" />
    {open && <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded border border-border bg-card shadow-lg">
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
        {matches.map((product, index) => <li key={product.id} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(product.id)}
          className={`cursor-pointer px-3 py-2 text-sm ${index === activeIndex ? "bg-primary/10 text-primary" : "text-foreground"}`}>
          {product.label}
        </li>)}
      </ul>
      {!matches.length && <p role="status" className="px-3 py-3 text-sm text-muted-foreground">No matches found. Try another name.</p>}
    </div>}
  </div>;
}
