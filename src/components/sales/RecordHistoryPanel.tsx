"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";

/** Progressive disclosure and pagination; filtering stays with the owning workflow. */
export function RecordHistoryPanel({ title, count, filterKey, defaultOpen = false, openLabel, filters, children }: {
  title: string;
  count: number;
  filterKey: string;
  defaultOpen?: boolean;
  openLabel?: string;
  filters: React.ReactNode;
  children: (start: number, end: number) => React.ReactNode;
}) {
  const { t } = useRegional();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [position, setPosition] = useState({ filterKey, page: 0 });
  const pageCount = Math.max(1, Math.ceil(count / 10));
  const page = Math.min(position.filterKey === filterKey ? position.page : 0, pageCount - 1);
  return <section className="workspace-section record-history">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span aria-hidden="true" className="surface-icon"><Search className="size-5" /></span><h2 className="text-lg font-semibold">{title}</h2><span className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">{count}</span></div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="workspace-button-secondary">
        {open ? t('common.close') : openLabel ?? t('sell.viewHistory')}<ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
    {open && <div id={id} className="mt-5 space-y-4 border-t border-border pt-5">
      {filters}
      {children(page * 10, (page + 1) * 10)}
      <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
        <span className="tabular-nums text-muted-foreground">{count ? page * 10 + 1 : 0}–{Math.min((page + 1) * 10, count)} / {count}</span>
        <div className="flex items-center gap-2"><button type="button" disabled={page === 0} onClick={() => setPosition({ filterKey, page: page - 1 })} className="workspace-button-secondary"><ChevronLeft className="size-4" />{t('common.back')}</button><span className="px-2 tabular-nums">{page + 1} / {pageCount}</span><button type="button" disabled={page === pageCount - 1} onClick={() => setPosition({ filterKey, page: page + 1 })} className="workspace-button-secondary">{t('common.next')}<ChevronRight className="size-4" /></button></div>
      </div>
    </div>}
  </section>;
}
