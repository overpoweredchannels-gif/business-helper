"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DASHBOARD_WIDGETS_CHANGE_EVENT,
  readDashboardWidgetPrefs,
  removedDashboardWidgets,
  resetDashboardWidgets,
  setDashboardWidgetHidden,
  type DashboardWidgetId,
} from "./dashboard-widgets";

/**
 * Owns the home dashboard layout for one profile: which cards are removed and
 * whether the dashboard is currently in edit mode.
 */
export function useDashboardWidgets(profileId: string | null | undefined) {
  const [hidden, setHidden] = useState<DashboardWidgetId[]>([]);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setHidden(readDashboardWidgetPrefs(profileId).hidden);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [profileId]);

  useEffect(() => {
    const onPrefsChange = (event: Event) => {
      const detail = (event as CustomEvent<{ profileId?: string | null }>).detail;
      if ((detail?.profileId ?? null) !== (profileId ?? null)) return;
      setHidden(readDashboardWidgetPrefs(profileId).hidden);
    };
    window.addEventListener(DASHBOARD_WIDGETS_CHANGE_EVENT, onPrefsChange);
    return () => window.removeEventListener(DASHBOARD_WIDGETS_CHANGE_EVENT, onPrefsChange);
  }, [profileId]);

  const isHidden = useCallback((id: DashboardWidgetId) => hidden.includes(id), [hidden]);
  const hide = useCallback((id: DashboardWidgetId) => setHidden(setDashboardWidgetHidden(profileId, id, true).hidden), [profileId]);
  const show = useCallback((id: DashboardWidgetId) => setHidden(setDashboardWidgetHidden(profileId, id, false).hidden), [profileId]);
  const reset = useCallback(() => setHidden(resetDashboardWidgets(profileId).hidden), [profileId]);
  const removed = useMemo(() => removedDashboardWidgets(hidden), [hidden]);

  return { hidden, isHidden, hide, show, reset, removed, customizing, setCustomizing };
}
