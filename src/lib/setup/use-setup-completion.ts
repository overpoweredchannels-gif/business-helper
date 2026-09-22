"use client";

import { useEffect, useState } from "react";
import { readSetupStage, type SetupStage } from "./setup-progress";

/** Reads the browser-stored setup checklist after mount so server markup stays stable. */
export function useSetupCompletion(organizationId: string | null | undefined, userId: string | null | undefined): SetupStage {
  const [stage, setStage] = useState<SetupStage>("active");
  useEffect(() => {
    if (!organizationId || !userId) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStage(readSetupStage(organizationId, userId));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [organizationId, userId]);
  return stage;
}
