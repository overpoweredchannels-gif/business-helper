"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";

interface SmartModuleProps {
  title: string;
  summary: string;
  onOpen?: () => void;
  children?: React.ReactNode;
  badge?: string;
  badgeColor?: "default" | "warning" | "success" | "danger";
}

export function SmartModule({ title, summary, onOpen, children, badge, badgeColor = "default" }: SmartModuleProps) {
  const [expanded, setExpanded] = useState(false);

  const badgeStyles = {
    default: "bg-muted text-muted-foreground",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
    danger: "bg-destructive/10 text-destructive",
  };

  // Step 5: expand and navigate are SIBLING buttons, never nested — the old
  // header was a <button> containing the "Open" <button>, invalid HTML.
  // Behaviour is identical: expand toggles children (or navigates when there
  // are none), Open always navigates.
  return (
    <div className="h-full rounded-xl border border-border bg-card shadow-sm transition-all duration-200 hover:shadow-[0_4px_16px_rgba(45,41,38,0.08)]">
      <div className="flex items-center justify-between gap-2 p-5">
        <button
          type="button"
          aria-expanded={children ? expanded : undefined}
          onClick={() => {
            if (children) {
              setExpanded(!expanded);
            } else if (onOpen) {
              onOpen();
            }
          }}
          className="flex flex-1 items-center gap-3 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
        >
          {children && (
            <ChevronRight
              className={cn(
                "size-4 text-light-text transition-transform duration-200 shrink-0",
                expanded && "rotate-90",
              )}
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {badge && (
                <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded", badgeStyles[badgeColor])}>
                  {badge}
                </span>
              )}
            </div>
            <p className="text-xs text-light-text mt-0.5 truncate">{summary}</p>
          </div>
        </button>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="flex min-h-11 items-center gap-1 px-2 text-xs font-medium text-primary hover:text-primary-hover transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
          >
            Open
            <ArrowUpRight className="size-3" />
          </button>
        )}
      </div>
      {expanded && children && (
        <div className="border-t border-border px-5 py-4 animate-slideUp">
          {children}
        </div>
      )}
    </div>
  );
}
