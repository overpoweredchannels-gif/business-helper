"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DASHBOARD_WIDGETS_CHANGE_EVENT,
  addDashboardSectionCard,
  readDashboardWidgetPrefs,
  removeDashboardSectionCard,
  removeDashboardWidget,
  removedDashboardWidgets,
  resetDashboardWidgets,
  setDashboardWidgetHidden,
  type DashboardWidgetId,
} from "./dashboard-widgets";
import { availableSectionCards } from "@/lib/dashboard/section-cards";
import type { SectionId } from "@/lib/tradeos/types";

/**
 * Owns the home dashboard layout for one profile: which cards are removed and
 * whether the dashboard is currently in edit mode.
 */
export function useDashboardWidgets(profileId: string | null | undefined) {
  const [hidden, setHidden] = useState<DashboardWidgetId[]>([]);
  const [added, setAdded] = useState<SectionId[]>([]);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const prefs = readDashboardWidgetPrefs(profileId);
    setHidden(prefs.hidden);
    setAdded(prefs.added);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [profileId]);

  useEffect(() => {
    const onPrefsChange = (event: Event) => {
      const detail = (event as CustomEvent<{ profileId?: string | null }>).detail;
      if ((detail?.profileId ?? null) !== (profileId ?? null)) return;
      const prefs = readDashboardWidgetPrefs(profileId);
      setHidden(prefs.hidden);
      setAdded(prefs.added);
    };
    window.addEventListener(DASHBOARD_WIDGETS_CHANGE_EVENT, onPrefsChange);
    return () => window.removeEventListener(DASHBOARD_WIDGETS_CHANGE_EVENT, onPrefsChange);
  }, [profileId]);

  const isHidden = useCallback((id: DashboardWidgetId) => hidden.includes(id), [hidden]);
  const hide = useCallback((id: DashboardWidgetId) => setHidden(setDashboardWidgetHidden(profileId, id, true).hidden), [profileId]);
  const show = useCallback((id: DashboardWidgetId) => setHidden(setDashboardWidgetHidden(profileId, id, false).hidden), [profileId]);
  const reset = useCallback(() => setHidden(resetDashboardWidgets(profileId).hidden), [profileId]);
  const addSection = useCallback((section: SectionId) => setAdded(addDashboardSectionCard(profileId, section).added), [profileId]);
  const removeSection = useCallback((section: SectionId) => setAdded(removeDashboardSectionCard(profileId, section).added), [profileId]);
  const removeWidget = useCallback((id: DashboardWidgetId) => {
    const prefs = removeDashboardWidget(profileId, id);
    setHidden(prefs.hidden);
    setAdded(prefs.added);
  }, [profileId]);
  const removed = useMemo(() => removedDashboardWidgets(hidden), [hidden]);
  const available = useMemo(() => availableSectionCards(added), [added]);

  return { hidden, added, isHidden, hide, show, reset, removed, available, addSection, removeSection, removeWidget, customizing, setCustomizing };
}
