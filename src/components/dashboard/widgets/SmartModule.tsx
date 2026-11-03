"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, ArrowUpRight, Layers } from "lucide-react";
import { useState } from "react";
import { dashboardReadStatusLabel, type DashboardReadStatus } from "@/lib/dashboard/data-read-state";
import { useRegional } from "@/components/regional/RegionalProvider";
import { navIconMap } from "../navigation-icons";

interface SmartModuleProps {
  sectionId?: string;
  title: string;
  summary: string;
  onOpen?: () => void;
  children?: React.ReactNode;
  badge?: string;
  badgeColor?: "default" | "warning" | "success" | "danger";
  readStatus?: DashboardReadStatus;
  lastSuccessfulAt?: string;
}

export function SmartModule({ sectionId, title, summary, onOpen, children, badge, badgeColor = "default", readStatus = "successful-populated", lastSuccessfulAt }: SmartModuleProps) {
  const { t } = useRegional();
  const [expanded, setExpanded] = useState(false);
  const Icon = (sectionId && navIconMap[sectionId]) || Layers;
  const readComplete = readStatus === "successful-empty" || readStatus === "successful-populated";
  const visibleChildren = readComplete ? children : undefined;
  const readLabel = dashboardReadStatusLabel(readStatus);

  const badgeStyles = {
    default: "bg-muted text-muted-foreground",
    warning: "bg-warning/10 text-warning-text",
    success: "bg-success/10 text-success",
    danger: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="smart-module aankh-card relative h-full rounded-xl border border-border bg-card transition-all duration-200">
      <div className="flex min-h-36 flex-col items-stretch justify-between gap-2 p-4">
        <button
          type="button"
          aria-expanded={visibleChildren ? expanded : undefined}
          onClick={() => {
            if (visibleChildren) {
              setExpanded(!expanded);
            } else if (onOpen) {
              onOpen();
            }
          }}
          className="relative flex min-h-14 flex-1 items-start gap-3 min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary"><Icon className="size-5" /></span>
          {visibleChildren && (
            <ChevronRight
              className={cn(
                "absolute end-0 top-0 size-3 text-light-text transition-transform duration-200 shrink-0",
                expanded && "rotate-90",
              )}
            />
          )}
          <div className="text-left min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {badge && (
                <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded", badgeStyles[badgeColor])}>
                  {badge}
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-light-text mt-1">{readLabel ?? summary}</p>
            {readStatus === "failed" && lastSuccessfulAt && <p className="text-[11px] text-muted-foreground">{t('dashboard.lastSuccessfulUpdate')}: {new Date(lastSuccessfulAt).toLocaleString()}</p>}
          </div>
        </button>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary-light hover:text-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('common.open')}
            <ArrowUpRight className="size-3" />
          </button>
        )}
      </div>
      {expanded && visibleChildren && (
        <div className="border-t border-border px-4 py-3 animate-slideUp">
          {visibleChildren}
        </div>
      )}
    </div>
  );
}
