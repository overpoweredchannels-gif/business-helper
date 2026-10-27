"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ClipboardList, Banknote, MapPin, Target, MessageSquareText, Users, Home,
  LogOut, Menu, X, LayoutDashboard, Store, Route as RouteIcon, Radar, Trophy, CalendarClock,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useCallback, useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { RegionalUiKey } from "@/lib/regional/ui-messages";
import { MobileNavigation } from "@/components/dashboard/MobileNavigation";

const NAV_ITEMS: { href: string; labelKey: RegionalUiKey; icon: React.ComponentType<{ className?: string }> }[] = [
  { href: "/manager", labelKey: "owner.nav.overview", icon: LayoutDashboard },
  { href: "/manager/drafts", labelKey: "owner.nav.drafts", icon: ClipboardList },
  { href: "/manager/collections", labelKey: "owner.nav.collections", icon: Banknote },
  { href: "/manager/visits", labelKey: "owner.nav.visits", icon: MapPin },
  { href: "/manager/customers", labelKey: "owner.nav.customers", icon: Store },
  { href: "/manager/routes", labelKey: "owner.nav.routes", icon: RouteIcon },
  { href: "/manager/live", labelKey: "owner.nav.live", icon: Radar },
  { href: "/manager/performance", labelKey: "owner.nav.performance", icon: Trophy },
  { href: "/manager/leaves", labelKey: "owner.nav.leaves", icon: CalendarClock },
  { href: "/manager/feedback", labelKey: "owner.nav.feedback", icon: MessageSquareText },
  { href: "/manager/targets", labelKey: "owner.nav.targets", icon: Target },
  { href: "/manager/team", labelKey: "owner.nav.team", icon: Users },
];

interface OwnerFsmLayoutProps {
  organizationName?: string | null;
  userName?: string | null;
  children: React.ReactNode;
}

export default function OwnerFsmLayout({ organizationName, userName, children }: OwnerFsmLayoutProps) {
  const { ui } = useRegional();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMenu = useCallback(() => setMobileOpen(false), []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const content = (
    <aside className="flex flex-col bg-card border-r border-border transition-all duration-300 h-full w-64">
      <div className="border-b border-border flex items-center gap-3 px-5 py-5">
        <div className="size-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-brand font-bold text-sm">T</span>
        </div>
        <div className="min-w-0">
          <div className="font-brand font-bold text-base text-foreground truncate">TradeOS</div>
          <div className="text-[10px] text-light-text truncate">{ui('owner.roleTitle')}</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <button
          onClick={() => router.push("/")}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground/70 hover:text-foreground hover:bg-muted transition-all duration-150"
        >
          <Home className="size-4.5 shrink-0" />
          <span>{ui('owner.mainApp')}</span>
        </button>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/manager" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                active ? "bg-primary text-primary-foreground font-medium" : "text-foreground/70 hover:text-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-4.5 shrink-0" />
              <span>{ui(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2 space-y-1">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="size-8 rounded-full bg-secondary flex items-center justify-center text-sm font-medium text-foreground">
            {(userName ?? "O").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{userName ?? ui('owner.userFallback')}</div>
            <div className="text-[10px] text-light-text">{organizationName ?? ui('owner.orgFallback')}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground/70 hover:text-foreground hover:bg-muted transition-all duration-150"
        >
          <LogOut className="size-4.5 shrink-0" />
          <span>{ui('owner.logOut')}</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-background flex">
      <div className="hidden lg:flex sticky top-0 h-screen">{content}</div>

      <div className="lg:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between bg-card border-b border-border px-4 h-14">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-brand font-bold text-xs">T</span>
          </div>
          <span className="font-brand font-bold text-sm text-foreground">{ui('owner.mobileTitle')}</span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg text-foreground hover:bg-muted transition-colors"
          aria-label={ui('owner.openMenu')}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <MobileNavigation open={mobileOpen} onClose={closeMenu}>{content}</MobileNavigation>

      <main className="responsive-content flex-1 lg:pt-0 pt-14 min-w-0 pb-20">
        <div className="p-4 md:p-6 max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  );
}