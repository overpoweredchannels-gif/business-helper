"use client";

import { useState } from "react";

export function ProductSearchSelect({ value, onChange, products, label = "Product", searchPlaceholder = "Search name, brand or SKU" }: {
  value: string;
  onChange: (value: string) => void;
  products: Array<{ id: string; label: string }>;
  label?: string;
  searchPlaceholder?: string;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const filtered = products.filter(product => product.id === value || product.label.toLocaleLowerCase().includes(query));
  return <div className="flex min-w-0 flex-col gap-1">
    <input type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder={searchPlaceholder} value={search}
      onChange={event => setSearch(event.target.value)} className="w-full rounded border border-border px-2 py-2" />
    <select required aria-label={label} value={value} onChange={event => onChange(event.target.value)}
      className="w-full rounded border border-border px-2 py-2">
      <option value="">{filtered.length ? `Select ${label.toLowerCase()}` : "No matches found"}</option>
      {filtered.map(product => <option key={product.id} value={product.id}>{product.label}</option>)}
    </select>
  </div>;
}
