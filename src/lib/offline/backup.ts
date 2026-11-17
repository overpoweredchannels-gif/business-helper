/**
 * Slice S8 — desktop Backup seam (Offline Tier-1).
 *
 * The renderer reaches the main process's backup actions over IPC
 * (see `electron/preload.ts`): Export writes the live database to a
 * user-chosen file, Restore validates a backup file and restarts the
 * app on it. Same seam discipline as the sale queue
 * (`src/lib/offline/local-store.ts`): the bridge is null outside the
 * desktop shell (or when the store failed to open) and every call
 * degrades to a plain failure the caller reports — the web build
 * never calls these at all (the Settings buttons render only in the
 * desktop shell).
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";

/** One Export / Restore result from the main process. */
export interface DesktopBackupResult {
  ok: boolean;
  /** File the backup was written to (export) or restored from. */
  path?: string;
  /** True when the user cancelled the native file dialog. */
  cancelled?: boolean;
  /** True when the app is about to restart on the restored database. */
  restarting?: boolean;
  /**
   * `store-unavailable` | `invalid-file` | `safety-backup-failed` |
   * `replace-failed` | `failed` — the caller maps these to messages.
   */
  error?: string;
}

export interface DesktopBackupBridge {
  /** Export the live database to a user-chosen file (native save dialog). */
  exportBackup(): Promise<DesktopBackupResult>;
  /** Restore a backup file over the live database (native open dialog); restarts the app on success. */
  restoreBackup(): Promise<DesktopBackupResult>;
  /** Desktop Backup menu: Export Backup File… */
  onMenuExportBackup(handler: () => void): () => void;
  /** Desktop Backup menu: Restore Backup File… */
  onMenuRestoreBackup(handler: () => void): () => void;
}

/** The preload bridge's backup methods, or null outside the desktop shell. */
export function desktopBackupBridge(): DesktopBackupBridge | null {
  if (typeof window === "undefined") return null;
  if (!isDesktopApp()) return null;
  const bridge = (window as unknown as { aankhDesktop?: { backup?: DesktopBackupBridge } })
    .aankhDesktop;
  return bridge?.backup ?? null;
}

/** Export the live database (native save dialog). Never throws. */
export async function exportDesktopBackup(): Promise<DesktopBackupResult> {
  const bridge = desktopBackupBridge();
  if (!bridge) return { ok: false, error: "store-unavailable" };
  try {
    return await bridge.exportBackup();
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** Restore a backup file (native open dialog). Never throws. */
export async function restoreDesktopBackup(): Promise<DesktopBackupResult> {
  const bridge = desktopBackupBridge();
  if (!bridge) return { ok: false, error: "store-unavailable" };
  try {
    return await bridge.restoreBackup();
  } catch {
    return { ok: false, error: "failed" };
  }
}
