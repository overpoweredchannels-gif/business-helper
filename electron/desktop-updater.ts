import type { AppUpdater } from "electron-updater";
import type { AppUpdaterEvents } from "electron-updater/out/AppUpdater";
import type { DesktopUpdateStatus } from "./updater-types";

interface DesktopUpdater extends Pick<AppUpdater, "autoDownload" | "autoInstallOnAppQuit" | "checkForUpdates" | "downloadUpdate" | "quitAndInstall"> {
  on<Event extends keyof AppUpdaterEvents>(event: Event, listener: AppUpdaterEvents[Event]): unknown;
}

type CheckSource = "launch" | "periodic" | "manual";

interface DesktopUpdaterOptions {
  updater: DesktopUpdater;
  currentVersion: string;
  publish: (status: DesktopUpdateStatus) => void;
  log: (message: string) => void;
  notifyAvailable: (version: string) => void;
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  if ("code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)) {
    return ` (${error.code})`;
  }
  if (
    "statusCode" in error && typeof error.statusCode === "number" &&
    Number.isInteger(error.statusCode) && error.statusCode >= 100 && error.statusCode <= 599
  ) {
    return ` (HTTP ${error.statusCode})`;
  }
  if ("message" in error && typeof error.message === "string") {
    const code = error.message.match(/\b(?:net::)?(ERR_[A-Z0-9_]{3,60}|EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT)\b/)?.[1];
    if (code) return ` (${code})`;
  }
  if ("name" in error && (error.name === "TypeError" || error.name === "CancellationError" || error.name === "HttpError")) {
    return ` (${error.name})`;
  }
  return "";
}

function estimatedSecondsRemaining({ bytesPerSecond, total, transferred }: {
  bytesPerSecond: number;
  total: number;
  transferred: number;
}): number | undefined {
  if (![bytesPerSecond, total, transferred].every(Number.isFinite)) return undefined;
  if (bytesPerSecond <= 0 || total <= 0 || transferred <= 0) return undefined;
  const estimate = Math.ceil(Math.max(total - transferred, 0) / bytesPerSecond);
  return Number.isFinite(estimate) ? estimate : undefined;
}

export function createDesktopUpdater({ updater, currentVersion, publish, log, notifyAvailable }: DesktopUpdaterOptions) {
  let status: DesktopUpdateStatus = { currentVersion, phase: "idle", promptOpen: false };
  let activeCheck: Promise<void> | null = null;
  let activeInstall: Promise<void> | null = null;
  let promptRequested = false;
  let checkFailed = false;
  let nextProgressLog = 10;
  const seenVersions = new Set<string>();

  function setStatus(next: Omit<DesktopUpdateStatus, "currentVersion">): void {
    status = { currentVersion, ...next };
    publish({ ...status });
  }

  function canInstall(): boolean {
    return Boolean(status.updateVersion) && (status.phase === "available" || status.phase === "error");
  }

  function openInstallPrompt(): void {
    if (status.promptOpen || !canInstall()) return;
    setStatus({ ...status, promptOpen: true });
  }

  function dismissInstallPrompt(): void {
    if (!status.promptOpen || !canInstall()) return;
    setStatus({ ...status, promptOpen: false });
  }

  function reportCheckError(error: unknown): void {
    if (checkFailed) return;
    checkFailed = true;
    log(`Desktop updater check failed${safeErrorCode(error)}.`);
    if (!status.updateVersion) setStatus({ phase: "error", promptOpen: false });
  }

  function reportInstallError(error: unknown): void {
    if (status.phase !== "downloading" && status.phase !== "installing") return;
    const stage = status.phase === "downloading" ? "download" : "install";
    log(`Desktop updater ${stage} failed${safeErrorCode(error)}.`);
    setStatus({ phase: "error", updateVersion: status.updateVersion, promptOpen: true });
  }

  async function runCheck(): Promise<void> {
    checkFailed = false;
    log(`Checking for a desktop update from ${currentVersion}.`);
    // Background checks keep the known version visible while they run.
    if (!status.updateVersion) setStatus({ phase: "checking", promptOpen: false });
    try {
      const result = await updater.checkForUpdates();
      if (checkFailed) return;
      if (!result) {
        log("Desktop updater did not run a check.");
        if (!status.updateVersion) setStatus({ phase: "unavailable", promptOpen: false });
        return;
      }
      if (!result.isUpdateAvailable) {
        log(`No desktop update available. Latest version: ${result.updateInfo.version}.`);
        if (!status.promptOpen) setStatus({ phase: "up-to-date", promptOpen: false });
        return;
      }
      const { version } = result.updateInfo;
      const newlyAvailable = !seenVersions.has(version);
      seenVersions.add(version);
      const promptOpen = promptRequested || status.promptOpen;
      log(`Desktop update ${version} is available.`);
      setStatus({ phase: "available", updateVersion: version, promptOpen });
      if (newlyAvailable && !status.promptOpen) notifyAvailable(version);
    } catch (error) {
      reportCheckError(error);
    }
  }

  async function runInstall(version: string): Promise<void> {
    // A check may already be finishing behind an opened notification. Its
    // metadata can supersede the version the user just agreed to install.
    if (activeCheck) await activeCheck;
    if (status.updateVersion !== version || !status.promptOpen || !canInstall()) return;
    nextProgressLog = 10;
    log(`Downloading desktop update ${version} after confirmation.`);
    setStatus({ phase: "downloading", updateVersion: version, promptOpen: true, progress: 0 });
    try {
      const files = await updater.downloadUpdate();
      if (status.phase !== "downloading") return;
      if (files.length === 0) {
        reportInstallError({ code: "NO_DOWNLOADED_INSTALLER" });
        return;
      }
      log(`Desktop update ${version} downloaded and verified. Restarting to install.`);
      setStatus({ phase: "installing", updateVersion: version, promptOpen: true });
      updater.quitAndInstall(true, true);
    } catch (error) {
      reportInstallError(error);
    }
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.on("download-progress", (info) => {
    const { percent } = info;
    if (status.phase !== "downloading" || !Number.isFinite(percent)) return;
    const progress = Math.max(0, Math.min(100, Math.floor(percent)));
    const remaining = estimatedSecondsRemaining(info);
    if (progress === status.progress && remaining === status.estimatedSecondsRemaining) return;
    if (progress >= nextProgressLog) {
      log(`Desktop update download ${progress}%.`);
      nextProgressLog = (Math.floor(progress / 10) + 1) * 10;
    }
    setStatus({ ...status, progress, estimatedSecondsRemaining: remaining });
  });
  updater.on("update-cancelled", () => reportInstallError({ code: "UPDATE_CANCELLED" }));
  updater.on("error", (error) => {
    if (activeCheck) reportCheckError(error);
    else reportInstallError(error);
  });
  log(`Desktop updater initialized for ${currentVersion}.`);

  return {
    getStatus: () => ({ ...status }),
    checkForUpdates(source: CheckSource): Promise<void> {
      const manualPrompt = source !== "periodic";
      if (activeInstall) return activeInstall;
      if (activeCheck) {
        promptRequested ||= manualPrompt;
        return activeCheck;
      }
      if (status.phase === "installing" || status.promptOpen) return Promise.resolve();
      if (manualPrompt && canInstall()) {
        openInstallPrompt();
        return Promise.resolve();
      }
      promptRequested = manualPrompt;
      activeCheck = Promise.resolve().then(runCheck).finally(() => { activeCheck = null; });
      return activeCheck;
    },
    openInstallPrompt,
    dismissInstallPrompt,
    installUpdate(): Promise<void> {
      if (activeInstall) return activeInstall;
      const version = status.updateVersion;
      if (!version || !status.promptOpen || !canInstall()) return Promise.resolve();
      activeInstall = Promise.resolve().then(() => runInstall(version)).finally(() => { activeInstall = null; });
      return activeInstall;
    },
  };
}
