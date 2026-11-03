"use client";
import { useEffect, useState } from "react";
import { DEFAULT_DASHBOARD_ORDER, moveDashboardWidget, readDashboardOrder, saveDashboardOrder } from "./dashboard-order";
import type { DashboardWidgetId } from "./dashboard-widgets";

export function useDashboardOrder(profileId?: string | null) {
  const [order, setOrder] = useState<DashboardWidgetId[]>(DEFAULT_DASHBOARD_ORDER);
  useEffect(() => {
    // The stored layout is scoped to this profile and read only after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(readDashboardOrder(profileId));
  }, [profileId]);
  const move = (id: DashboardWidgetId, direction: "up" | "down", visible: DashboardWidgetId[]) => setOrder(current => saveDashboardOrder(profileId, moveDashboardWidget(current, id, direction, visible)));
  const reset = () => setOrder(saveDashboardOrder(profileId, DEFAULT_DASHBOARD_ORDER));
  return { order, move, reset };
}
