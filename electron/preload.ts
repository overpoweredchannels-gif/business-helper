import { contextBridge, ipcRenderer } from "electron";
import type { LocalSaleRow, StoredIdentity } from "./store";

// Slice S0 — minimal, context-isolated bridge. Slice S2 adds the
// local-first store: the main process owns the SQLite database
// (electron/store.ts) and the renderer reaches it over IPC. Every method
// below is one invoke round-trip; a rejection means the store is
// unavailable and the renderer falls back to browser storage (see
// src/lib/offline/local-store.ts).

/** IPC channels for the local store. The renderer (src/lib/offline/…)
 * uses the same literal strings — keep them in sync when renaming. */
const CHANNELS = {
  listSales: "aankh:local-sales:list",
  replaceSales: "aankh:local-sales:replace",
  removeSale: "aankh:local-sales:remove",
  getIdentity: "aankh:identity:get",
  setIdentity: "aankh:identity:set",
  clearIdentity: "aankh:identity:clear",
} as const;

export interface AankhLocalSalesBridge {
  /** Queued sales for a scope, oldest first. */
  list(scope: string): Promise<LocalSaleRow[]>;
  /** Replace the whole queue for a scope; returns the stored rows (with provisional numbers assigned). */
  replace(scope: string, rows: LocalSaleRow[]): Promise<LocalSaleRow[]>;
  /** Delete one queued sale. */
  remove(scope: string, requestId: string): Promise<void>;
}

export interface AankhIdentityBridge {
  /** The cached identity from SQLite, or null. */
  get(): Promise<StoredIdentity | null>;
  /** Store (or replace) the cached identity. */
  set(entry: StoredIdentity): Promise<void>;
  /** Drop the cached identity (sign-out). */
  clear(): Promise<void>;
}

export interface AankhDesktopBridge {
  /** True when the app runs inside the installed desktop shell. */
  isDesktop: true;
  /** Operating system the shell runs on (win32, darwin, linux). */
  platform: NodeJS.Platform;
  /** The local-first SQLite store (S2). Absent when the store failed to open. */
  localSales?: AankhLocalSalesBridge;
  /** The SQLite-backed identity cache (S2). Absent when the store failed to open. */
  identity?: AankhIdentityBridge;
}

const bridge: AankhDesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  localSales: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listSales, scope),
    replace: (scope, rows) => ipcRenderer.invoke(CHANNELS.replaceSales, scope, rows),
    remove: (scope, requestId) => ipcRenderer.invoke(CHANNELS.removeSale, scope, requestId),
  },
  identity: {
    get: () => ipcRenderer.invoke(CHANNELS.getIdentity),
    set: (entry) => ipcRenderer.invoke(CHANNELS.setIdentity, entry),
    clear: () => ipcRenderer.invoke(CHANNELS.clearIdentity),
  },
};

contextBridge.exposeInMainWorld("aankhDesktop", bridge);

declare global {
  interface Window {
    aankhDesktop: AankhDesktopBridge;
  }
}
