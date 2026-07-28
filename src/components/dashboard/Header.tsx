"use client";

import { cn } from "@/lib/utils";
import { Search, Bell, Sparkles, Menu, X, LogOut, User, AlertCircle, Package, DollarSign } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface SearchSuggestion {
  label: string;
  section?: string;
  type?: "product" | "customer" | "task" | "action";
}

interface Notification {
  id: string;
  title: string;
  description?: string;
  severity?: "info" | "warning" | "critical";
  section?: string;
  time?: string;
}

interface HeaderProps {
  userName?: string;
  organizationName?: string;
  onSearchSubmit?: (query: string) => void;
  onSearchChange?: (query: string) => SearchSuggestion[];
  onToggleMobileMenu?: () => void;
  mobileMenuOpen?: boolean;
  onLogout?: () => void;
  onOpenAiAssistant?: () => void;
  notificationCount?: number;
  notifications?: Notification[];
  onNotificationClick?: (notification: Notification) => void;
}

export function Header({
  userName,
  organizationName,
  onSearchSubmit,
  onSearchChange,
  onToggleMobileMenu,
  mobileMenuOpen,
  onLogout,
  onOpenAiAssistant,
  notificationCount = 0,
  notifications = [],
  onNotificationClick,
}: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const suggestions = onSearchChange ? onSearchChange(searchQuery) : [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      onSearchSubmit?.(searchQuery.trim());
      setShowSuggestions(false);
    }
  };

  const severityStyles = {
    info: "border-l-primary bg-primary-light/30",
    warning: "border-l-warning bg-warning/5",
    critical: "border-l-destructive bg-destructive-bg",
  };

  const severityIcons = {
    info: AlertCircle,
    warning: AlertCircle,
    critical: Package,
  };

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="flex items-center justify-between h-14 px-4 sm:px-6 lg:px-8">
        {/* Mobile menu + Logo */}
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

        {/* Business name */}
        <div className="hidden lg:flex items-center gap-2">
          {organizationName && (
            <span className="text-sm font-medium text-foreground">{organizationName}</span>
          )}
        </div>

        {/* Right: Search, AI, Notifications, Profile */}
        <div className="flex items-center gap-1">
          {/* Search */}
          <div ref={searchRef} className="relative hidden sm:block">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground w-48 lg:w-64 transition-all focus-within:bg-card focus-within:ring-2 focus-within:ring-ring">
              <Search className="size-4 shrink-0" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={handleKeyDown}
                className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground w-full"
              />
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full mt-1 left-0 w-full rounded-xl border border-border bg-card shadow-lg p-1 z-50 animate-scaleIn">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSearchQuery(s.label);
                      setShowSuggestions(false);
                      if (s.section) onSearchSubmit?.(s.section);
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
                  >
                    {s.type === "product" && <Package className="size-3.5 text-primary" />}
                    {s.type === "customer" && <User className="size-3.5 text-primary" />}
                    {s.type === "action" && <Sparkles className="size-3.5 text-primary" />}
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="sm:hidden size-9 flex items-center justify-center rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
          >
            {searchOpen ? <X className="size-4" /> : <Search className="size-4" />}
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
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative size-9 flex items-center justify-center rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
            >
              <Bell className="size-4.5" />
              {notificationCount > 0 && (
                <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive" />
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-xl border border-border bg-card shadow-lg p-1 animate-scaleIn">
                <div className="px-3 py-2 border-b border-border mb-1">
                  <p className="text-sm font-semibold text-foreground">Notifications</p>
                </div>
                {notifications.length === 0 ? (
                  <p className="text-sm text-light-text px-3 py-6 text-center">No new notifications</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {notifications.map((n) => {
                      const Icon = severityIcons[n.severity || "info"];
                      return (
                        <button
                          key={n.id}
                          onClick={() => {
                            onNotificationClick?.(n);
                            setNotifOpen(false);
                          }}
                          className={cn(
                            "w-full text-left flex gap-3 px-3 py-2.5 rounded-lg mb-0.5 border-l-2 transition-colors hover:bg-muted",
                            severityStyles[n.severity || "info"],
                          )}
                        >
                          <Icon className="size-4 mt-0.5 shrink-0 text-foreground/70" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                            {n.description && <p className="text-xs text-light-text mt-0.5 line-clamp-2">{n.description}</p>}
                            {n.time && <p className="text-[10px] text-light-text/70 mt-0.5">{n.time}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

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
      {searchOpen && (
        <div ref={searchRef} className="sm:hidden border-t border-border bg-card px-4 py-3 animate-slideUp">
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground transition-all focus-within:bg-card focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-4 shrink-0" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground w-full"
            />
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="mt-1 rounded-xl border border-border bg-card shadow-lg p-1 animate-scaleIn">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSearchQuery(s.label);
                    setShowSuggestions(false);
                    setSearchOpen(false);
                    if (s.section) onSearchSubmit?.(s.section);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
                >
                  {s.type === "product" && <Package className="size-3.5 text-primary" />}
                  {s.type === "customer" && <User className="size-3.5 text-primary" />}
                  {s.type === "action" && <Sparkles className="size-3.5 text-primary" />}
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
