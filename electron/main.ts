import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, type ChildProcess } from "node:child_process";
import * as http from "node:http";
import { createServer as createNetServer } from "node:net";
import * as path from "node:path";
import { createLocalStore, type LocalSaleRow, type LocalStore, type StoredIdentity } from "./store";

// Slice S0 — desktop shell spike. Serves the Next.js standalone build from
// the local disk: the main process spawns .next/standalone/server.js on a
// random loopback port and opens a window at that URL. Slice S2 adds the
// local-first SQLite store (electron/store.ts) over IPC — no sync engine
// yet; the queue drain still runs in the renderer, pointed at SQLite in
// the desktop build.

const DEV_SERVER_URL = "http://localhost:3000";
const MAX_SERVER_RESTARTS = 5;
const SERVER_HEALTH_TIMEOUT_MS = 30_000;
const DEV_HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_POLL_INTERVAL_MS = 250;
const SERVER_RESTART_DELAY_MS = 1_000;

const ERROR_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Aankh</title></head><body style="font-family:sans-serif;padding:40px;color:#222"><h1>Aankh could not start</h1><p>The local app server did not start. Please close the app and open it again. If the problem continues, reinstall Aankh.</p></body></html>`;

let serverProcess: ChildProcess | null = null;
let serverRestarts = 0;
let mainWindow: BrowserWindow | null = null;
let quitting = false;
let localStore: LocalStore | null = null;

function setupLocalStore(): void {
  // Slice S2 — the local-first SQLite store. A failure here must never
  // stop the app: the preload bridge simply omits the store methods and
  // the renderer falls back to browser storage (same as the web app).
  try {
    localStore = createLocalStore(path.join(app.getPath("userData"), "aankh.db"));
  } catch (error) {
    console.error("Aankh local store unavailable — sales queue falls back to browser storage:", error);
    localStore = null;
    return;
  }
  const requireScope = (value: unknown): string => {
    if (typeof value !== "string" || value.length === 0) throw new Error("Invalid scope");
    return value;
  };
  const requireSaleRows = (value: unknown): LocalSaleRow[] => {
    if (!Array.isArray(value)) throw new Error("Invalid sale rows");
    return value.map((row): LocalSaleRow => {
      const item = row as Partial<LocalSaleRow>;
      if (typeof item.requestId !== "string" || item.requestId.length === 0) {
        throw new Error("Invalid sale row: requestId");
      }
      if (typeof item.input !== "object" || item.input === null || Array.isArray(item.input)) {
        throw new Error("Invalid sale row: input");
      }
      return {
        requestId: item.requestId,
        input: item.input as Record<string, unknown>,
        provisionalNumber: typeof item.provisionalNumber === "string" ? item.provisionalNumber : null,
        // Slice S4: the first-queued time crosses IPC with the row — the
        // history shows it as the sale time.
        createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
      };
    });
  };
  ipcMain.handle("aankh:local-sales:list", (_event, scope: unknown) =>
    (localStore as LocalStore).listSales(requireScope(scope)),
  );
  ipcMain.handle("aankh:local-sales:replace", (_event, scope: unknown, rows: unknown) =>
    (localStore as LocalStore).replaceSales(requireScope(scope), requireSaleRows(rows)),
  );
  ipcMain.handle("aankh:local-sales:remove", (_event, scope: unknown, requestId: unknown) => {
    if (typeof requestId !== "string" || requestId.length === 0) throw new Error("Invalid requestId");
    (localStore as LocalStore).removeSale(requireScope(scope), requestId);
  });
  ipcMain.handle("aankh:identity:get", () => (localStore as LocalStore).getIdentity());
  ipcMain.handle("aankh:identity:set", (_event, entry: unknown) => {
    (localStore as LocalStore).setIdentity(entry as StoredIdentity);
  });
  ipcMain.handle("aankh:identity:clear", () => (localStore as LocalStore).clearIdentity());
  // Slice S3 — owner-only Sync issues (parked sales + unlinked
  // provisional numbers). Same validation discipline as the sale rows:
  // the renderer sends plain JSON and the main process refuses anything
  // malformed before it reaches SQLite.
  const requireIssue = (value: unknown): import("./store").SyncIssueRow => {
    const row = value as Partial<import("./store").SyncIssueRow>;
    if (typeof row !== "object" || row === null) throw new Error("Invalid sync issue");
    if (typeof row.id !== "string" || row.id.length === 0) throw new Error("Invalid sync issue: id");
    if (typeof row.scope !== "string" || row.scope.length === 0) throw new Error("Invalid sync issue: scope");
    if (typeof row.kind !== "string" || row.kind.length === 0) throw new Error("Invalid sync issue: kind");
    if (typeof row.reason !== "string" || row.reason.length === 0) throw new Error("Invalid sync issue: reason");
    if (typeof row.status !== "string" || row.status.length === 0) throw new Error("Invalid sync issue: status");
    return {
      id: row.id,
      scope: row.scope,
      kind: row.kind,
      requestId: typeof row.requestId === "string" ? row.requestId : null,
      provisionalNumber: typeof row.provisionalNumber === "string" ? row.provisionalNumber : null,
      serverInvoiceNumber: typeof row.serverInvoiceNumber === "string" ? row.serverInvoiceNumber : null,
      serverId: typeof row.serverId === "string" ? row.serverId : null,
      customerName: typeof row.customerName === "string" ? row.customerName : null,
      total: typeof row.total === "number" ? row.total : null,
      reason: row.reason,
      payloadJson: typeof row.payloadJson === "string" ? row.payloadJson : null,
      status: row.status,
      syncError: typeof row.syncError === "string" ? row.syncError : null,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
    };
  };
  ipcMain.handle("aankh:sync-issues:list", (_event, scope: unknown) =>
    (localStore as LocalStore).listIssues(requireScope(scope)),
  );
  ipcMain.handle("aankh:sync-issues:upsert", (_event, issue: unknown) =>
    (localStore as LocalStore).upsertIssue(requireIssue(issue)),
  );
  ipcMain.handle("aankh:sync-issues:set-status", (_event, scope: unknown, id: unknown, status: unknown) => {
    if (typeof id !== "string" || id.length === 0) throw new Error("Invalid sync issue id");
    if (typeof status !== "string" || status.length === 0) throw new Error("Invalid sync issue status");
    (localStore as LocalStore).setIssueStatus(requireScope(scope), id, status);
  });
  ipcMain.handle("aankh:sync-issues:update", (_event, scope: unknown, id: unknown, patch: unknown) => {
    if (typeof id !== "string" || id.length === 0) throw new Error("Invalid sync issue id");
    const text = patch as { reason?: unknown; syncError?: unknown };
    (localStore as LocalStore).updateIssue(requireScope(scope), id, {
      reason: typeof text?.reason === "string" ? text.reason : undefined,
      syncError: typeof text?.syncError === "string" ? text.syncError : text?.syncError === null ? null : undefined,
    });
  });
  // Slice S4 — Sales History + Inventory mirrors (read cache for the
  // desktop history + inventory). Same validation discipline: the
  // renderer sends plain JSON and the main process refuses anything
  // malformed before it reaches SQLite. The mirror never carries
  // balances — it stores the rows the fetch functions already return.
  const MIRROR_KINDS = new Set(["sales_transaction", "sales_item", "product"]);
  const requireMirrorKind = (value: unknown): import("./store").MirrorKind => {
    if (typeof value !== "string" || !MIRROR_KINDS.has(value)) throw new Error("Invalid mirror kind");
    return value as import("./store").MirrorKind;
  };
  const requireMirrorRow = (value: unknown): { id: string; data: Record<string, unknown> } => {
    const row = value as Partial<{ id: unknown; data: unknown }>;
    if (typeof row !== "object" || row === null) throw new Error("Invalid mirror row");
    if (typeof row.id !== "string" || row.id.length === 0) throw new Error("Invalid mirror row: id");
    if (typeof row.data !== "object" || row.data === null || Array.isArray(row.data)) {
      throw new Error("Invalid mirror row: data");
    }
    return { id: row.id, data: row.data as Record<string, unknown> };
  };
  const requireMirrorRows = (value: unknown): Array<{ id: string; data: Record<string, unknown> }> => {
    if (!Array.isArray(value)) throw new Error("Invalid mirror rows");
    return value.map(requireMirrorRow);
  };
  ipcMain.handle("aankh:mirror:list", (_event, kind: unknown, scope: unknown) =>
    (localStore as LocalStore).listMirror(requireMirrorKind(kind), requireScope(scope)),
  );
  ipcMain.handle("aankh:mirror:replace", (_event, kind: unknown, scope: unknown, rows: unknown) =>
    (localStore as LocalStore).replaceMirror(requireMirrorKind(kind), requireScope(scope), requireMirrorRows(rows)),
  );
  ipcMain.handle("aankh:mirror:upsert", (_event, kind: unknown, scope: unknown, row: unknown) =>
    (localStore as LocalStore).upsertMirror(requireMirrorKind(kind), requireScope(scope), requireMirrorRow(row)),
  );
}

function standaloneServerPath(): string {
  if (app.isPackaged) {
    // electron-builder copies .next/standalone to resources/standalone
    // (extraResources), outside the asar, so Node can execute it.
    return path.join(process.resourcesPath, "standalone", "server.js");
  }
  return path.join(app.getAppPath(), ".next", "standalone", "server.js");
}

function preloadPath(): string {
  return path.join(app.getAppPath(), "dist-electron", "main", "preload.js");
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function checkHealth(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      // Any HTTP response (200, or the 307 to the sign-in page) means the
      // server is up.
      response.resume();
      resolve(true);
    });
    request.once("error", () => resolve(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHealth(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

function startStandaloneServer(port: number): ChildProcess {
  // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node,
  // so server.js runs as an ordinary Node script instead of an app entry.
  const child = spawn(process.execPath, [standaloneServerPath()], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", () => {
    serverProcess = null;
  });
  child.once("exit", () => {
    serverProcess = null;
    if (!quitting) {
      void restartStandaloneServer();
    }
  });
  return child;
}

async function showErrorPage(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(ERROR_HTML)}`,
    );
  }
}

async function restartStandaloneServer(): Promise<void> {
  if (quitting || serverRestarts >= MAX_SERVER_RESTARTS) {
    await showErrorPage();
    return;
  }
  serverRestarts += 1;
  await new Promise((resolve) => setTimeout(resolve, SERVER_RESTART_DELAY_MS));
  if (quitting) return;
  const port = await pickFreePort();
  serverProcess = startStandaloneServer(port);
  const url = `http://127.0.0.1:${port}/`;
  const healthy = await waitForHealth(url, SERVER_HEALTH_TIMEOUT_MS);
  if (!healthy) {
    await restartStandaloneServer();
    return;
  }
  serverRestarts = 0;
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(url);
  }
}

async function resolveAppUrl(): Promise<string | null> {
  const devUrl = process.env.AANKH_DEV_URL;
  if (devUrl) {
    const healthy = await waitForHealth(devUrl, SERVER_HEALTH_TIMEOUT_MS);
    return healthy ? devUrl : null;
  }
  if (!app.isPackaged) {
    // Dev loop: prefer the running `next dev` server when it is up, so
    // edits reload without rebuilding the standalone output.
    const devHealthy = await waitForHealth(DEV_SERVER_URL, DEV_HEALTH_TIMEOUT_MS);
    if (devHealthy) return DEV_SERVER_URL;
  }
  const port = await pickFreePort();
  serverProcess = startStandaloneServer(port);
  const url = `http://127.0.0.1:${port}/`;
  const healthy = await waitForHealth(url, SERVER_HEALTH_TIMEOUT_MS);
  if (healthy) serverRestarts = 0;
  return healthy ? url : null;
}

function createWindow(url: string | null): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  if (url) {
    void mainWindow.loadURL(url);
  } else {
    void mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(ERROR_HTML)}`,
    );
  }
}

function setupAutoUpdater(): void {
  // Updates are best-effort and must never crash the app: no release is
  // published yet, and the shop PC may be offline at launch.
  if (!app.isPackaged) return;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", () => {
    // No release feed, no network, or no update — stay on the current build.
  });
  void autoUpdater.checkForUpdatesAndNotify().catch(() => {
    // Same: best-effort only.
  });
}

void app.whenReady().then(async () => {
  setupLocalStore();
  setupAutoUpdater();
  const url = await resolveAppUrl();
  createWindow(url);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
  if (localStore) {
    try {
      localStore.close();
    } catch {
      // Best-effort: the OS reclaims the handle on exit.
    }
    localStore = null;
  }
});
