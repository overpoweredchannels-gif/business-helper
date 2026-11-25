import type { AppUpdater } from "electron-updater";
import type { AppUpdaterEvents } from "electron-updater/out/AppUpdater";
import type { DesktopUpdateCheckResult, DesktopUpdateStatus } from "./updater-types";

interface DesktopUpdater extends Pick<AppUpdater, "autoDownload" | "autoInstallOnAppQuit" | "checkForUpdates" | "downloadUpdate" | "quitAndInstall"> {
  on<Event extends keyof AppUpdaterEvents>(event: Event, listener: AppUpdaterEvents[Event]): unknown;
}

type CheckSource = "launch" | "periodic" | "manual";

const INSTALL_HANDOFF_DELAY_MS = 300;
const NO_CHECK_RESULT: DesktopUpdateCheckResult = { isUpdateAvailable: false, versionInfo: null };

interface DesktopUpdaterOptions {
  updater: DesktopUpdater;
  currentVersion: string;
  publish: (status: DesktopUpdateStatus) => void;
  log: (message: string, error?: unknown) => void;
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
  if (bytesPerSecond <= 0 || total <= 0 || transferred < 0) return undefined;
  const estimate = Math.ceil(Math.max(total - transferred, 0) / bytesPerSecond);
  return Number.isFinite(estimate) ? estimate : undefined;
}

export function createDesktopUpdater({ updater, currentVersion, publish, log, notifyAvailable }: DesktopUpdaterOptions) {
  let status: DesktopUpdateStatus = { currentVersion, phase: "idle", promptOpen: false };
  let activeCheck: Promise<DesktopUpdateCheckResult> | null = null;
  let activeInstall: Promise<void> | null = null;
  let lastCheckResult = NO_CHECK_RESULT;
  let promptRequested = false;
  let checkFailed = false;
  let detectedVersion: string | undefined;
  let downloadedFile: string | undefined;
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
    log(`Desktop updater check failed${safeErrorCode(error)}.`, error);
    setStatus({
      phase: "error",
      promptOpen: status.promptOpen,
      ...(status.updateVersion ? { updateVersion: status.updateVersion } : {}),
    });
  }

  function reportInstallError(error: unknown): void {
    if (status.phase !== "downloading" && status.phase !== "installing") return;
    const stage = status.phase === "downloading" ? "download" : "install";
    log(`Desktop updater ${stage} failed${safeErrorCode(error)}.`, error);
    setStatus({ phase: "error", updateVersion: status.updateVersion, promptOpen: true });
  }

  async function runCheck(): Promise<DesktopUpdateCheckResult> {
    checkFailed = false;
    detectedVersion = undefined;
    log(`Checking for a desktop update from ${currentVersion}.`);
    // Background checks keep the known version visible while they run.
    if (!status.updateVersion) setStatus({ phase: "checking", promptOpen: false });
    try {
      const result = await updater.checkForUpdates();
      if (checkFailed) return NO_CHECK_RESULT;
      if (!result) {
        log("Desktop updater did not run a check.");
        if (!status.updateVersion) setStatus({ phase: "unavailable", promptOpen: false });
        return NO_CHECK_RESULT;
      }
      const { version } = result.updateInfo;
      const checked = { isUpdateAvailable: result.isUpdateAvailable, versionInfo: { version } };
      if (!result.isUpdateAvailable) {
        log(`No desktop update available. Latest version: ${version}.`);
        if (!status.promptOpen) setStatus({ phase: "up-to-date", promptOpen: false });
        lastCheckResult = checked;
        return checked;
      }
      if (detectedVersion !== undefined && detectedVersion !== version) {
        reportCheckError({ code: "UPDATE_VERSION_MISMATCH" });
        return NO_CHECK_RESULT;
      }
      lastCheckResult = checked;
      const newlyAvailable = !seenVersions.has(version);
      seenVersions.add(version);
      const promptOpen = promptRequested || status.promptOpen;
      log(`Desktop update ${version} is available.`);
      setStatus({ phase: "available", updateVersion: version, promptOpen });
      if (newlyAvailable && !promptOpen) notifyAvailable(version);
      return checked;
    } catch (error) {
      reportCheckError(error);
      return NO_CHECK_RESULT;
    }
  }

  async function runInstall(version: string): Promise<void> {
    // A check may already be finishing behind an opened notification. Its
    // metadata can supersede the version the user just agreed to install.
    if (activeCheck) await activeCheck;
    if (status.updateVersion !== version || !status.promptOpen || !canInstall()) return;
    downloadedFile = undefined;
    nextProgressLog = 10;
    log(`Downloading desktop update ${version} after confirmation.`);
    setStatus({ phase: "downloading", updateVersion: version, promptOpen: true, progress: 0 });
    try {
      const files = await updater.downloadUpdate();
      if (status.phase !== "downloading") return;
      if (!downloadedFile || !files.includes(downloadedFile)) {
        reportInstallError({ code: "UNVERIFIED_DOWNLOADED_INSTALLER" });
        return;
      }
      log(`Desktop update ${version} downloaded and verified. Restarting to install.`);
      setStatus({ phase: "installing", updateVersion: version, promptOpen: true });
      // Give the renderer a moment to display the handoff before NSIS
      // closes the application to replace its installed files.
      await new Promise<void>((resolve) => setTimeout(resolve, INSTALL_HANDOFF_DELAY_MS));
      if (getStatus().phase === "installing") updater.quitAndInstall(true, true);
    } catch (error) {
      reportInstallError(error);
    }
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-available", ({ version }) => {
    // The SDK emits this before checkForUpdates resolves. Defer the offer
    // until the result is known so a joined manual check can open a modal.
    if (activeCheck) detectedVersion = version;
  });
  updater.on("download-progress", (info) => {
    const { percent } = info;
    if (status.phase !== "downloading" || !Number.isFinite(percent)) return;
    const progress = Math.max(0, Math.min(100, Math.floor(percent)));
    const remaining = estimatedSecondsRemaining(info);
    const transferredBytes = Number.isFinite(info.transferred) && info.transferred >= 0 ? info.transferred : undefined;
    const totalBytes = Number.isFinite(info.total) && info.total > 0 ? info.total : undefined;
    const bytesPerSecond = Number.isFinite(info.bytesPerSecond) && info.bytesPerSecond >= 0 ? info.bytesPerSecond : undefined;
    if (
      progress === status.progress && remaining === status.estimatedSecondsRemaining &&
      transferredBytes === status.transferredBytes && totalBytes === status.totalBytes && bytesPerSecond === status.bytesPerSecond
    ) return;
    // The transfer can restart with a different total if a differential
    // download falls back to fetching the complete installer.
    if (progress < (status.progress ?? 0)) nextProgressLog = 10;
    const logProgress = Math.floor(progress / 10) * 10;
    if (logProgress >= nextProgressLog) {
      log(`Desktop update download ${logProgress}%.`);
      nextProgressLog = logProgress + 10;
    }
    setStatus({ ...status, progress, transferredBytes, totalBytes, bytesPerSecond, estimatedSecondsRemaining: remaining });
  });
  updater.on("update-downloaded", ({ version, downloadedFile: installerPath }) => {
    // A cache hit can reach this event without a single progress update.
    // The SDK still has bookkeeping to finish after it emits this event.
    if (status.phase !== "downloading" || version !== status.updateVersion || !installerPath || downloadedFile) return;
    downloadedFile = installerPath;
  });
  updater.on("update-cancelled", () => reportInstallError({ code: "UPDATE_CANCELLED" }));
  updater.on("error", (error) => {
    if (activeCheck) reportCheckError(error);
    else reportInstallError(error);
  });
  log(`Desktop updater initialized for ${currentVersion}.`);

  const getStatus = () => ({ ...status });
  return {
    getStatus,
    checkForUpdates(source: CheckSource): Promise<DesktopUpdateCheckResult> {
      const manualPrompt = source !== "periodic";
      if (activeCheck) {
        promptRequested ||= manualPrompt;
        return activeCheck;
      }
      if (activeInstall || status.phase === "installing" || status.promptOpen) return Promise.resolve(lastCheckResult);
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
