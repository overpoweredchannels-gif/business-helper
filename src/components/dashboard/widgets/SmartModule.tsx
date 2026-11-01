"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { dashboardReadStatusLabel, type DashboardReadStatus } from "@/lib/dashboard/data-read-state";
import { useRegional } from "@/components/regional/RegionalProvider";

interface SmartModuleProps {
  title: string;
  summary: string;
  onOpen?: () => void;
  children?: React.ReactNode;
  badge?: string;
  badgeColor?: "default" | "warning" | "success" | "danger";
  readStatus?: DashboardReadStatus;
  lastSuccessfulAt?: string;
}

export function SmartModule({ title, summary, onOpen, children, badge, badgeColor = "default", readStatus = "successful-populated", lastSuccessfulAt }: SmartModuleProps) {
  const { t } = useRegional();
  const [expanded, setExpanded] = useState(false);
  const readComplete = readStatus === "successful-empty" || readStatus === "successful-populated";
  const visibleChildren = readComplete ? children : undefined;
  const readLabel = dashboardReadStatusLabel(readStatus);

  const badgeStyles = {
    default: "bg-muted text-muted-foreground",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
    danger: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.06),0_16px_32px_-16px_rgb(15_23_42/0.20)] transition-all duration-200 hover:shadow-[0_4px_16px_rgba(45,41,38,0.08)]">
      <div className="flex items-center justify-between gap-2 p-4">
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
          className="flex flex-1 items-center gap-3 min-w-0 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visibleChildren && (
            <ChevronRight
              className={cn(
                "size-4 text-light-text transition-transform duration-200 shrink-0",
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
            <p className="text-xs text-light-text mt-0.5 truncate">{readLabel ?? summary}</p>
            {readStatus === "failed" && lastSuccessfulAt && <p className="text-[11px] text-muted-foreground">{t('dashboard.lastSuccessfulUpdate')}: {new Date(lastSuccessfulAt).toLocaleString()}</p>}
          </div>
        </button>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:text-primary-hover transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
