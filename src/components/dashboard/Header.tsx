"use client";

import { cn } from "@/lib/utils";
import { Search, Bell, Sparkles, Menu, X, LogOut, User, AlertCircle, Package, DollarSign } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { activeSuggestionIndex } from "@/components/invoices/search-selection";
import { SuggestionPopover, type SuggestionStatus } from "@/components/search/SuggestionPopover";
import { useSuggestionPlacement } from "@/components/search/useSuggestionPlacement";

export interface SearchSuggestion {
  id: string;
  label: string;
  detail?: string;
  /** Exact filter text to prefill when the suggestion navigates to a section. */
  prefill?: string;
  /** Record ID to pin first in the destination section (duplicate names). */
  recordId?: string;
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
  onSearchSubmit?: (query: string, prefill?: string, recordId?: string) => void;
  onSearchChange?: (query: string) => SearchSuggestion[];
  /** Remounts the search boxes on account/organization change, clearing old-scope state. */
  searchScopeKey?: string;
  /** Authoritative read state for the product suggestions (sections are local). */
  productStatus?: SuggestionStatus;
  /** "See all results in Products" footer; omitted when the user may not open Products. */
  onViewAllProducts?: (query: string) => void;
  onToggleMobileMenu?: () => void;
  mobileMenuOpen?: boolean;
  onLogout?: () => void;
  onOpenAiAssistant?: () => void;
  notificationCount?: number;
  notifications?: Notification[];
  onNotificationClick?: (notification: Notification) => void;
}

function suggestionIcon(type: SearchSuggestion["type"]) {
  if (type === "product") return <Package className="size-3.5 shrink-0 text-primary" />;
  if (type === "customer") return <User className="size-3.5 shrink-0 text-primary" />;
  return <Sparkles className="size-3.5 shrink-0 text-primary" />;
}

/**
 * Dashboard global search field: typing shows relevance-ranked section and
 * product suggestions in the shared compact panel (exact matches first),
 * with full keyboard support and combobox/listbox semantics. Selecting a
 * product suggestion navigates to Products with the filter prefilled to the
 * exact product name, so the record is the first row without scrolling.
 */
function HeaderSearchBox({
  idPrefix,
  autoFocus,
  query,
  onQueryChange,
  suggestions,
  onSelectSuggestion,
  onSubmitQuery,
  productStatus = "ready",
  onViewAllProducts,
  className,
}: {
  idPrefix: string;
  autoFocus?: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  suggestions: SearchSuggestion[];
  onSelectSuggestion: (suggestion: SearchSuggestion) => void;
  onSubmitQuery: (query: string) => void;
  productStatus?: SuggestionStatus;
  onViewAllProducts?: (query: string) => void;
  className?: string;
}) {
  const listId = `${idPrefix}-suggestions`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const trimmed = query.trim();
  const showPopover = open && trimmed.length > 0;
  const activeIndex = activeSuggestionIndex(suggestions, "", active);
  const { anchorRef, placement, maxHeightPx } = useSuggestionPlacement(showPopover);
  const hasProductSuggestions = suggestions.some((suggestion) => suggestion.type === "product");
  // Sections are local; the authoritative product read state only gates the
  // product half of the panel: loading/error messaging appears only when it
  // actually concerns what is shown.
  const panelStatus: SuggestionStatus =
    productStatus === "loading"
      ? (suggestions.length === 0 ? "loading" : "ready")
      : productStatus === "error"
        ? (hasProductSuggestions ? "error" : "ready")
        : "ready";

  const select = (id: string) => {
    const suggestion = suggestions.find((item) => item.id === id);
    setOpen(false);
    setActive(null);
    if (suggestion) onSelectSuggestion(suggestion);
  };

  return (
    <div ref={anchorRef} className={cn("relative min-w-0", className)}>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground transition-all focus-within:bg-card focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0" />
        <input
          type="text"
          role="combobox"
          aria-label="Search sections and products"
          aria-autocomplete="list"
          aria-expanded={showPopover}
          aria-controls={listId}
          aria-activedescendant={showPopover && suggestions.length ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          placeholder="Search products..."
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => { onQueryChange(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => { if (trimmed) { setActive(0); setOpen(true); } }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const direction = e.key === "ArrowDown" ? 1 : -1;
              setActive(showPopover ? activeSuggestionIndex(suggestions, "", activeIndex + direction) : 0);
              setOpen(true);
            } else if (e.key === "Enter") {
              if (showPopover && suggestions[activeIndex]) {
                e.preventDefault();
                select(suggestions[activeIndex].id);
              } else {
                setOpen(false);
                onSubmitQuery(trimmed);
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground w-full"
        />
      </div>
      {showPopover && (
        <SuggestionPopover
          listId={listId}
          ariaLabel="Search suggestions"
          placement={placement}
          maxHeightPx={maxHeightPx}
          items={suggestions.map((suggestion) => ({
            id: suggestion.id,
            label: suggestion.label,
            detail: suggestion.detail,
            icon: suggestionIcon(suggestion.type),
          }))}
          activeIndex={activeIndex}
          query={trimmed}
          status={panelStatus}
          staleText="Couldn't refresh products — showing saved results."
          errorText="Couldn't load product results."
          emptyText="No matches found."
          footer={
            onViewAllProducts && hasProductSuggestions
              ? { actionLabel: "See all results in Products", onAction: () => { setOpen(false); onViewAllProducts(trimmed); } }
              : undefined
          }
          onSelect={select}
          onHover={setActive}
        />
      )}
    </div>
  );
}

export function Header({
  userName,
  organizationName,
  onSearchSubmit,
  onSearchChange,
  searchScopeKey,
  productStatus,
  onViewAllProducts,
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
  const notifRef = useRef<HTMLDivElement>(null);

  // Memoized so unrelated parent rerenders don't re-rank thousands of products.
  const suggestions = useMemo(
    () => (onSearchChange ? onSearchChange(searchQuery) : []),
    [onSearchChange, searchQuery],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectSuggestion = (suggestion: SearchSuggestion) => {
    setSearchQuery(suggestion.label);
    setSearchOpen(false);
    if (suggestion.section) onSearchSubmit?.(suggestion.section, suggestion.prefill, suggestion.recordId);
  };
  const handleSubmitQuery = (query: string) => {
    if (!query.trim()) return;
    onSearchSubmit?.(query.trim());
    setSearchOpen(false);
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
        <div className="flex min-w-0 items-center gap-1 sm:gap-3 lg:hidden">
          <button
            onClick={onToggleMobileMenu}
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            className="size-11 shrink-0 flex items-center justify-center rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
          >
            {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-brand font-bold text-[10px]">T</span>
            </div>
            <span className="font-brand font-bold text-sm text-foreground hidden min-[375px]:inline">TradeOS</span>
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
          <HeaderSearchBox
            key={`desktop:${searchScopeKey ?? "default"}`}
            idPrefix="header-search-desktop"
            query={searchQuery}
            onQueryChange={setSearchQuery}
            suggestions={suggestions}
            onSelectSuggestion={handleSelectSuggestion}
            onSubmitQuery={handleSubmitQuery}
            productStatus={productStatus}
            onViewAllProducts={onViewAllProducts}
            className="hidden w-48 sm:block lg:w-64"
          />
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            aria-label="Search sections and products"
            className="sm:hidden size-11 shrink-0 flex items-center justify-center rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
          >
            {searchOpen ? <X className="size-4" /> : <Search className="size-4" />}
          </button>

          {/* AI Assistant */}
          <button
            onClick={onOpenAiAssistant}
            className="size-11 shrink-0 flex items-center justify-center rounded-lg text-primary hover:bg-primary-light transition-colors"
            title="AI Assistant"
          >
            <Sparkles className="size-4.5" />
          </button>

          {/* Notifications */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              aria-label="Notifications"
              className="relative size-11 shrink-0 flex items-center justify-center rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
            >
              <Bell className="size-4.5" />
              {notificationCount > 0 && (
                <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive" />
              )}
            </button>
            {notifOpen && (
              <div className="fixed right-3 left-3 top-16 z-50 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 sm:w-80 rounded-xl border border-border bg-card shadow-lg p-1 animate-scaleIn">
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
                <button
                  type="button"
                  onClick={() => {
                    onNotificationClick?.({ id: "notifications-center", title: "View all notifications", section: "notifications" });
                    setNotifOpen(false);
                  }}
                  className="w-full text-center rounded-lg px-3 py-2 text-xs font-medium text-primary hover:bg-muted transition-colors"
                >
                  View all notifications
                </button>
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
        <div className="sm:hidden border-t border-border bg-card px-4 py-3 animate-slideUp">
          <HeaderSearchBox
            key={`mobile:${searchScopeKey ?? "default"}`}
            idPrefix="header-search-mobile"
            autoFocus
            query={searchQuery}
            onQueryChange={setSearchQuery}
            suggestions={suggestions}
            onSelectSuggestion={handleSelectSuggestion}
            onSubmitQuery={handleSubmitQuery}
            productStatus={productStatus}
            onViewAllProducts={onViewAllProducts}
          />
        </div>
      )}
    </header>
  );
}
