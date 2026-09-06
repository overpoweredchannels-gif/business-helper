"use client";

import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { FloatingAI } from "./FloatingAI";
import { MobileNavigation } from "./MobileNavigation";
import { useCallback, useState } from "react";
import type { SectionId } from "@/lib/tradeos/types";

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
  onSearchSubmit?: (query: string) => void;
  onSearchChange?: (query: string) => Array<{ label: string; section?: string; type?: "product" | "customer" | "task" | "action" }>;
  customizeMode?: boolean;
  hiddenNavIds?: string[];
  canCustomize?: boolean;
  onToggleCustomize?: () => void;
  onMoveNavItem?: (id: string, direction: "up" | "down") => void;
  onDropNavItem?: (fromId: string, toId: string) => void;
  onToggleNavHidden?: (id: string) => void;
  onResetNavOrder?: () => void;
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
customizeMode,
  hiddenNavIds,
  canCustomize,
  onToggleCustomize,
  onMoveNavItem,
  onDropNavItem,
  onToggleNavHidden,
  onResetNavOrder,
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
        />
        <main className="responsive-content min-w-0 flex-1 pb-24 lg:pb-8">
          {children}
        </main>
      </div>

      <FloatingAI onVoice={onAiVoice} onChat={onAiChat} />
    </div>
  );
}
