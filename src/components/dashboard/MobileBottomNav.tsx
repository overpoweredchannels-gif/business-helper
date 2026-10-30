"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface BottomNavItem {
  label: string;
  icon: React.ReactNode;
  /** Route link. Exactly one of href / onClick is set for a navigation item. */
  href?: string;
  /** Section / action handler (owner app sections, or the More dialog opener). */
  onClick?: () => void;
  /** Destination items show an active state; action items (New Sale, More) never do. */
  active?: boolean;
  /** Centre primary item: filled primary background, same height as the other items. */
  primary?: boolean;
}

/**
 * Fixed bottom navigation for phones and tablets below 1024px.
 * Hidden on desktop (lg:), where the fixed sidebar is the navigation.
 * Each item is at least 44px tall; the bar adds env(safe-area-inset-bottom)
 * so it never sits under a phone's home indicator. "More" is not a
 * destination — the layout passes the same opener that the header menu
 * button uses, so More opens the one native <dialog> mobile navigation.
 */
export function MobileBottomNav({ items }: { items: BottomNavItem[] }) {
  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 lg:hidden border-t border-border bg-card shadow-[0_-2px_12px_rgba(15,23,42,0.08)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {items.map((item) => {
          const content = (
            <>
              <span className="size-5 shrink-0 flex items-center justify-center [&>svg]:size-5">{item.icon}</span>
              <span className="text-[11px] font-medium leading-none truncate max-w-full">{item.label}</span>
            </>
          );
          const className = cn(
            "flex flex-col items-center justify-center gap-1 min-h-14 px-1 py-2 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            item.primary
              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
              : item.active
                ? "text-primary"
                : "text-foreground/70 hover:text-foreground hover:bg-muted",
          );
          if (item.href) {
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={className}
              >
                {content}
              </Link>
            );
          }
          return (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              aria-label={item.label === "More" ? "Open full navigation menu" : item.label}
              className={className}
            >
              {content}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
