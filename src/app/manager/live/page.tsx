"use client";

import LiveTrackingView from "@/components/fsm/LiveTrackingView";

export default function ManagerLiveTrackingPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Live Workforce Tracking</h1>
        <p className="text-sm text-body mt-1">
          Click any employee below to see their live location on the map, navigate to them, or view their movement
          trail.
        </p>
      </div>
      <LiveTrackingView />
    </div>
  );
}