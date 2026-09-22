"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { readCollapsedBanners, writeCollapsedBanner, type DashboardBannerId } from "@/lib/preferences/dashboard-banners";

/** A dashboard banner that can be folded down to its title row without leaving the page. */
export function CollapsibleBanner({ id, profileId, title, subtitle, topic, className = "", children }: {
  id: DashboardBannerId;
  profileId?: string | null;
  title: string;
  subtitle?: string;
  topic?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = readCollapsedBanners(profileId)[id];
    if (typeof stored !== "boolean") return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setCollapsed(stored);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [id, profileId]);

  const toggle = () => setCollapsed(current => {
    const next = !current;
    writeCollapsedBanner(profileId, id, next);
    return next;
  });

  return (
    <section data-help-topic={topic} className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {!collapsed && subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={`${id}-body`}
          aria-label={collapsed ? `Show ${title}` : `Hide ${title}`}
          title={collapsed ? `Show ${title}` : `Hide ${title}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          <span>{collapsed ? "Show" : "Hide"}</span>
        </button>
      </div>
      {!collapsed && <div id={`${id}-body`} className="mt-3">{children}</div>}
    </section>
  );
}
