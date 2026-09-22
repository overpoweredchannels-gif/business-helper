"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DASHBOARD_BANNER_CHANGE_EVENT, readCollapsedBanners, writeCollapsedBanner, type DashboardBannerChange, type DashboardBannerId } from "@/lib/preferences/dashboard-banners";

/** A dashboard banner that can be folded down to its title row without leaving the page. */
export function CollapsibleBanner({ id, profileId, title, label, subtitle, topic, heading = "h2", titleClassName = "text-lg font-semibold", className = "", children }: {
  id: DashboardBannerId;
  profileId?: string | null;
  title: React.ReactNode;
  label?: string;
  subtitle?: string;
  topic?: string;
  heading?: "h1" | "h2";
  titleClassName?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = readCollapsedBanners(profileId)[id];
    if (typeof stored !== "boolean") return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setCollapsed(stored);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [id, profileId]);

  useEffect(() => {
    // The dashboard can fold a banner from outside this component, so mirror any
    // folded-state change made in this tab immediately instead of waiting for a remount.
    const onBannerChange = (event: Event) => {
      const detail = (event as CustomEvent<DashboardBannerChange>).detail;
      if (!detail || detail.id !== id || (detail.profileId ?? null) !== (profileId ?? null)) return;
      setCollapsed(detail.collapsed);
    };
    window.addEventListener(DASHBOARD_BANNER_CHANGE_EVENT, onBannerChange);
    return () => window.removeEventListener(DASHBOARD_BANNER_CHANGE_EVENT, onBannerChange);
  }, [id, profileId]);

  const toggle = () => setCollapsed(current => {
    const next = !current;
    writeCollapsedBanner(profileId, id, next);
    return next;
  });

  const accessibleName = label ?? (typeof title === "string" ? title : "this section");
  return (
    <section data-help-topic={topic} className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {heading === "h1" ? <h1 className={titleClassName}>{title}</h1> : <h2 className={titleClassName}>{title}</h2>}
          {!collapsed && subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={children ? `${id}-body` : undefined}
          aria-label={collapsed ? `Show ${accessibleName}` : `Hide ${accessibleName}`}
          title={collapsed ? `Show ${accessibleName}` : `Hide ${accessibleName}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          <span>{collapsed ? "Show" : "Hide"}</span>
        </button>
      </div>
      {!collapsed && children ? <div id={`${id}-body`} className="mt-3">{children}</div> : null}
    </section>
  );
}
