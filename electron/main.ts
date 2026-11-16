import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, type ChildProcess } from "node:child_process";
import * as http from "node:http";
import { createServer as createNetServer } from "node:net";
import * as path from "node:path";

// Slice S0 — desktop shell spike. Serves the Next.js standalone build from
// the local disk: the main process spawns .next/standalone/server.js on a
// random loopback port and opens a window at that URL. No SQLite, no sync,
// no local store yet — the window shows the existing app in online mode.

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
});
