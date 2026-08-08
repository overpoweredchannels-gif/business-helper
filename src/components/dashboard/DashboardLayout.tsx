"use client";

import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { FloatingAI } from "./FloatingAI";
import { useState } from "react";
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

  return (
    <div className="flex min-h-screen bg-background">
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
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-[19rem] bg-card border-r border-border lg:hidden animate-slideInLeft">
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
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-h-screen">
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
        <main className="flex-1">
          {children}
        </main>
      </div>

      <FloatingAI onVoice={onAiVoice} onChat={onAiChat} />
    </div>
  );
}
