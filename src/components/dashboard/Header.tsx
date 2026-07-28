"use client";

import { cn } from "@/lib/utils";
import { Search, Bell, Sparkles, Menu, X, LogOut, User } from "lucide-react";
import { useState } from "react";

interface HeaderProps {
  userName?: string;
  organizationName?: string;
  onSearch?: (query: string) => void;
  onToggleMobileMenu?: () => void;
  mobileMenuOpen?: boolean;
  onLogout?: () => void;
  onOpenAiAssistant?: () => void;
  notificationCount?: number;
}

export function Header({
  userName,
  organizationName,
  onToggleMobileMenu,
  mobileMenuOpen,
  onLogout,
  onOpenAiAssistant,
  notificationCount = 0,
}: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="flex items-center justify-between h-14 px-4 sm:px-6 lg:px-8">
        {/* Left: Mobile menu + Logo */}
        <div className="flex items-center gap-3 lg:hidden">
          <button
            onClick={onToggleMobileMenu}
            className="size-9 flex items-center justify-center rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
          >
            {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-brand font-bold text-[10px]">T</span>
            </div>
            <span className="font-brand font-bold text-sm text-foreground">TradeOS</span>
          </div>
        </div>

        {/* Center: Business name */}
        <div className="hidden lg:flex items-center gap-2">
          {organizationName && (
            <span className="text-sm font-medium text-foreground">{organizationName}</span>
          )}
        </div>

        {/* Right: Search, AI, Notifications, Profile */}
        <div className="flex items-center gap-1">
          {/* Search */}
          <div className="hidden sm:flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground w-48 lg:w-64 transition-all focus-within:bg-card focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-4 shrink-0" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground w-full"
            />
          </div>
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="sm:hidden size-9 flex items-center justify-center rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
          >
            <Search className="size-4" />
          </button>

          {/* AI Assistant */}
          <button
            onClick={onOpenAiAssistant}
            className="size-9 flex items-center justify-center rounded-lg text-primary hover:bg-primary-light transition-colors"
            title="AI Assistant"
          >
            <Sparkles className="size-4.5" />
          </button>

          {/* Notifications */}
          <button className="relative size-9 flex items-center justify-center rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors">
            <Bell className="size-4.5" />
            {notificationCount > 0 && (
              <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive" />
            )}
          </button>

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
            >
              <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="size-3.5 text-primary" />
              </div>
              <span className="hidden sm:inline text-sm font-medium max-w-[120px] truncate">{userName || "User"}</span>
            </button>
            {profileOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-border bg-card shadow-lg p-1 animate-scaleIn">
                  <div className="px-3 py-2 border-b border-border mb-1">
                    <p className="text-sm font-medium text-foreground truncate">{userName || "User"}</p>
                    {organizationName && (
                      <p className="text-[11px] text-light-text truncate">{organizationName}</p>
                    )}
                  </div>
                  <button
                    onClick={onLogout}
                    className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/5 transition-colors"
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
