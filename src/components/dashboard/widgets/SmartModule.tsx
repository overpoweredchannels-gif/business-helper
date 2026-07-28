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

  return (
    <div className="rounded-xl border border-border bg-card transition-all duration-200 hover:shadow-[0_4px_16px_rgba(45,41,38,0.08)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight
            className={cn(
              "size-4 text-light-text transition-transform duration-200 shrink-0",
              expanded && "rotate-90",
            )}
          />
          <div className="text-left min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {badge && (
                <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", badgeStyles[badgeColor])}>
                  {badge}
                </span>
              )}
            </div>
            <p className="text-xs text-light-text mt-0.5 truncate">{summary}</p>
          </div>
        </div>
        {onOpen && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover transition-colors shrink-0 ml-3"
          >
            Open
            <ArrowUpRight className="size-3" />
          </button>
        )}
      </button>
      {expanded && children && (
        <div className="border-t border-border px-4 py-3 animate-slideUp">
          {children}
        </div>
      )}
    </div>
  );
}
