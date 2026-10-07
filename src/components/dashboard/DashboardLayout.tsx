"use client";

import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { FloatingAI } from "./FloatingAI";
import { MobileNavigation } from "./MobileNavigation";
import { useCallback, useState } from "react";
import type { SectionId } from "@/lib/tradeos/types";
import type { SuggestionStatus } from "@/components/search/SuggestionPopover";

interface Notification {
  id: string;
  title: string;
  description?: string;
  severity?: "info" | "warning" | "critical";
  section?: string;
  time?: string;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  navigationItems: Array<{ id: SectionId; label: string }>;
  activeSection: SectionId;
  onSectionChange: (id: SectionId) => void;
  organizationName?: string;
  userName?: string;
  onLogout?: () => void;
  onOpenAiAssistant?: () => void;
  onAiVoice?: () => void;
  onAiChat?: () => void;
  notificationCount?: number;
  notifications?: Notification[];
  onNotificationClick?: (notification: Notification) => void;
  onSearchSubmit?: (query: string, prefill?: string, recordId?: string) => void;
  onSearchChange?: (query: string) => Array<{ id: string; label: string; detail?: string; prefill?: string; recordId?: string; section?: string; type?: "product" | "customer" | "task" | "action" }>;
  /** Remounts the header search boxes on account/organization change. */
  searchScopeKey?: string;
  /** Authoritative read state for the header's product suggestions. */
  productStatus?: SuggestionStatus;
  /** "See all results in Products" footer; omit when the user may not open Products. */
  onViewAllProducts?: (query: string) => void;
  customizeMode?: boolean;
  hiddenNavIds?: string[];
  canCustomize?: boolean;
  onToggleCustomize?: () => void;
  onMoveNavItem?: (id: string, direction: "up" | "down") => void;
  onDropNavItem?: (fromId: string, toId: string) => void;
  onToggleNavHidden?: (id: string) => void;
  onResetNavOrder?: () => void;
  /** Home dashboard edit mode: sidebar sections become draggable cards. */
  dragSectionsToDashboard?: boolean;
}

export function DashboardLayout({
  children,
  navigationItems,
  activeSection,
  onSectionChange,
  organizationName,
  userName,
  onLogout,
  onOpenAiAssistant,
  onAiVoice,
  onAiChat,
  notificationCount,
  notifications,
  onNotificationClick,
  onSearchSubmit,
  onSearchChange,
  searchScopeKey,
  productStatus,
  onViewAllProducts,
customizeMode,
  hiddenNavIds,
  canCustomize,
  onToggleCustomize,
  onMoveNavItem,
  onDropNavItem,
  onToggleNavHidden,
  onResetNavOrder,
  dragSectionsToDashboard,
}: DashboardLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMobileMenuOpen(false), []);

  return (
    <div className="flex min-h-dvh w-full min-w-0 bg-background">
      <Sidebar
        items={navigationItems}
        activeSection={activeSection}
        onSectionChange={(id) => {
          onSectionChange(id);
          setMobileMenuOpen(false);
        }}
        organizationName={organizationName}
        customizeMode={customizeMode}
        hiddenIds={hiddenNavIds}
        canCustomize={canCustomize}
        onToggleCustomize={onToggleCustomize}
        onMoveItem={onMoveNavItem}
        onDropItem={onDropNavItem}
        onToggleHidden={onToggleNavHidden}
        onResetOrder={onResetNavOrder}
        dragToDashboard={dragSectionsToDashboard}
      />

      {/* Mobile sidebar overlay */}
      <MobileNavigation open={mobileMenuOpen} onClose={closeMenu}>
            <Sidebar
              items={navigationItems}
              activeSection={activeSection}
              onSectionChange={(id) => {
                onSectionChange(id);
                setMobileMenuOpen(false);
              }}
              organizationName={organizationName}
              forceVisible
              disableCollapse
              customizeMode={customizeMode}
              hiddenIds={hiddenNavIds}
              canCustomize={canCustomize}
              onToggleCustomize={onToggleCustomize}
              onMoveItem={onMoveNavItem}
              onDropItem={onDropNavItem}
              onToggleHidden={onToggleNavHidden}
              onResetOrder={onResetNavOrder}
              dragToDashboard={dragSectionsToDashboard}
            />
      </MobileNavigation>

      <div className="min-w-0 flex-1 flex flex-col min-h-dvh">
        <Header
          userName={userName}
          organizationName={organizationName}
          onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
          mobileMenuOpen={mobileMenuOpen}
          onLogout={onLogout}
          onOpenAiAssistant={onOpenAiAssistant}
          notificationCount={notificationCount}
          notifications={notifications}
          onNotificationClick={onNotificationClick}
          onSearchSubmit={onSearchSubmit}
          onSearchChange={onSearchChange}
          searchScopeKey={searchScopeKey}
          productStatus={productStatus}
          onViewAllProducts={onViewAllProducts}
        />
        <main className="responsive-content min-w-0 flex-1 pb-24 lg:pb-8">
          {children}
        </main>
      </div>

      <FloatingAI onVoice={onAiVoice} onChat={onAiChat} />
    </div>
  );
}
