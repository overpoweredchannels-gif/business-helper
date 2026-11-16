import { contextBridge } from "electron";

// Slice S0 — minimal, context-isolated bridge. No local-store methods yet;
// those arrive with the SQLite slices (S2+).
export interface AankhDesktopBridge {
  /** True when the app runs inside the installed desktop shell. */
  isDesktop: true;
  /** Operating system the shell runs on (win32, darwin, linux). */
  platform: NodeJS.Platform;
}

const bridge: AankhDesktopBridge = {
  isDesktop: true,
  platform: process.platform,
};

contextBridge.exposeInMainWorld("aankhDesktop", bridge);

declare global {
  interface Window {
    aankhDesktop: AankhDesktopBridge;
  }
}
