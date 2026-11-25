import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateCheckResult, UpdateInfo } from "electron-updater";
import { createDesktopUpdater } from "../electron/desktop-updater";
import { createUpdaterLogger } from "../electron/updater-log";
import type { DesktopUpdateStatus } from "../electron/updater-types";

const currentVersion = "0.1.5";
const updateVersion = "0.1.6";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkCount = 0;
  downloadCount = 0;
  installs: Array<[boolean | undefined, boolean | undefined]> = [];
  nextCheck: () => Promise<UpdateCheckResult | null> = async () => null;
  nextDownload: () => Promise<string[]> = async () => [];

  checkForUpdates(): Promise<UpdateCheckResult | null> {
    this.checkCount += 1;
    return this.nextCheck();
  }

  downloadUpdate(): Promise<string[]> {
    this.downloadCount += 1;
    return this.nextDownload();
  }

  quitAndInstall(isSilent?: boolean, runAfter?: boolean): void {
    this.installs.push([isSilent, runAfter]);
  }
}

function checked(version: string, isUpdateAvailable: boolean): UpdateCheckResult {
  const info: UpdateInfo = { version, files: [], path: "", sha512: "", releaseDate: "" };
  return { isUpdateAvailable, updateInfo: info, versionInfo: info };
}

function setup() {
  const updater = new FakeUpdater();
  const statuses: DesktopUpdateStatus[] = [];
  const logs: string[] = [];
  const notifications: string[] = [];
  const controller = createDesktopUpdater({
    updater,
    currentVersion,
    publish: (status) => statuses.push(status),
    log: (message) => logs.push(message),
    notifyAvailable: (version) => notifications.push(version),
  });
  return { updater, controller, statuses, logs, notifications };
}

async function verifyLaunchAndInstall(): Promise<void> {
  const { updater, controller, statuses, logs, notifications } = setup();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "idle", promptOpen: false });
  assert.match(logs.join("\n"), /0\.1\.5/);

  updater.nextCheck = async () => checked(currentVersion, false);
  await controller.checkForUpdates("launch");
  assert.deepEqual(statuses.map((status) => status.phase), ["checking", "up-to-date"]);

  const checkError = Object.assign(new Error("private download URL and credentials"), { code: "ERR_INTERNET_DISCONNECTED" });
  updater.nextCheck = async () => {
    updater.emit("error", checkError);
    throw checkError;
  };
  await controller.checkForUpdates("manual");
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "error", promptOpen: false });
  assert.equal(statuses.filter((status) => status.phase === "error").length, 1);
  assert.equal(logs.filter((entry) => entry.includes("ERR_INTERNET_DISCONNECTED")).length, 1);
  assert.doesNotMatch(logs.join("\n"), /private download URL and credentials/);

  updater.nextCheck = async () => checked(updateVersion, true);
  await controller.checkForUpdates("launch");
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "available", updateVersion, promptOpen: true });
  assert.deepEqual(notifications, [], "launch shows the modal without a toast");
  assert.equal(updater.downloadCount, 0, "launch discovery does not download");

  controller.dismissInstallPrompt();
  await controller.installUpdate();
  assert.equal(updater.downloadCount, 0, "a dismissed prompt does not authorize the download");
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "available", updateVersion, promptOpen: false });
  await controller.checkForUpdates("periodic");
  assert.deepEqual(notifications, [], "rediscovering the launch version does not send a toast");
  assert.equal(controller.getStatus().promptOpen, false);

  await controller.checkForUpdates("manual");
  assert.equal(controller.getStatus().promptOpen, true, "a manual check can re-offer the known update");
  assert.equal(updater.downloadCount, 0);

  updater.nextDownload = async () => {
    throw new Error("net::ERR_CONNECTION_RESET https://example.test/?token=private");
  };
  await controller.installUpdate();
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "error", updateVersion, promptOpen: true });
  assert.equal(updater.downloadCount, 1);
  assert.equal(updater.installs.length, 0, "a rejected download must never install");
  assert.match(logs.join("\n"), /download failed.*ERR_CONNECTION_RESET/i);
  assert.doesNotMatch(logs.join("\n"), /example\.test|token=private/);

  let finishDownload: (files: string[]) => void = () => assert.fail("download was not started");
  updater.nextDownload = () => new Promise<string[]>((resolve) => { finishDownload = resolve; });
  const installation = controller.installUpdate();
  assert.equal(controller.installUpdate(), installation, "repeated confirmation shares the active download");
  const checkCount = updater.checkCount;
  assert.equal(controller.checkForUpdates("periodic"), installation, "periodic checks wait while downloading");
  await Promise.resolve();
  assert.equal(updater.downloadCount, 2);
  assert.equal(updater.checkCount, checkCount);
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "downloading", updateVersion, promptOpen: true, progress: 0 });

  updater.emit("download-progress", { percent: 10, bytesPerSecond: 0, total: 1000, transferred: 100 });
  assert.equal(controller.getStatus().estimatedSecondsRemaining, undefined);
  updater.emit("download-progress", { percent: 10, bytesPerSecond: 49, total: 1000, transferred: 100 });
  assert.equal(controller.getStatus().estimatedSecondsRemaining, 19, "round estimated seconds up and publish ETA changes even when percent is unchanged");
  updater.emit("download-progress", { percent: 10.9, bytesPerSecond: Number.NaN, total: 1000, transferred: 109 });
  assert.equal(controller.getStatus().progress, 10);
  assert.equal(controller.getStatus().estimatedSecondsRemaining, undefined);
  updater.emit("download-progress", { percent: 10.9, bytesPerSecond: 50, total: 1000, transferred: 109 });
  assert.equal(controller.getStatus().estimatedSecondsRemaining, 18);
  assert.equal(logs.filter((entry) => /%/.test(entry)).length, 1, "progress logs are throttled");
  assert.equal(updater.installs.length, 0);

  finishDownload(["Aankh.exe"]);
  await installation;
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "installing", updateVersion, promptOpen: true });
  assert.deepEqual(updater.installs, [[true, true]], "the verified update installs and relaunches");
  assert.ok(statuses.every((status) => status.currentVersion === currentVersion));

  updater.emit("error", Object.assign(new Error("cannot install"), { code: "EACCES" }));
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "error", updateVersion, promptOpen: true });
  assert.match(logs.join("\n"), /install failed.*EACCES/i);
}

async function verifyPeriodicOffers(): Promise<void> {
  const { updater, controller, notifications } = setup();
  await controller.checkForUpdates("launch");
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "unavailable", promptOpen: false });

  updater.nextCheck = async () => checked(updateVersion, true);
  await controller.checkForUpdates("periodic");
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "available", updateVersion, promptOpen: false });
  assert.deepEqual(notifications, [updateVersion], "periodic discovery produces a toast without opening a modal");
  controller.openInstallPrompt();
  assert.equal(controller.getStatus().promptOpen, true, "clicking the toast opens the modal");
  await controller.checkForUpdates("periodic");
  assert.equal(controller.getStatus().promptOpen, true, "a timer cannot close an open modal");
  controller.dismissInstallPrompt();
  await controller.checkForUpdates("periodic");
  assert.deepEqual(notifications, [updateVersion], "a version produces at most one toast per session");
  assert.equal(updater.downloadCount, 0);

  let finishCheck: (result: UpdateCheckResult) => void = () => assert.fail("check was not started");
  updater.nextCheck = () => new Promise<UpdateCheckResult>((resolve) => { finishCheck = resolve; });
  const backgroundCheck = controller.checkForUpdates("periodic");
  await Promise.resolve();
  const checkCount = updater.checkCount;
  assert.equal(controller.checkForUpdates("manual"), backgroundCheck);
  finishCheck(checked("0.1.7", true));
  await backgroundCheck;
  assert.equal(updater.checkCount, checkCount, "a manual check joins the running periodic check");
  assert.deepEqual(controller.getStatus(), { currentVersion, phase: "available", updateVersion: "0.1.7", promptOpen: true });
  assert.deepEqual(notifications, [updateVersion], "a promoted check offers a modal without toasting");
}

async function main(): Promise<void> {
  await verifyLaunchAndInstall();
  await verifyPeriodicOffers();
  const logDirectory = mkdtempSync(join(tmpdir(), "aankh-updater-log-"));
  try {
    const logPath = join(logDirectory, "updater.log");
    const logger = createUpdaterLogger(logPath);
    logger.transports.console.level = false;
    logger.info("Desktop update 0.1.6 is available.");
    logger.error(new Error(
      "HTTP 403 from https://user:password@example.test/latest.yml?sig=signed-value\nHeaders: private-response",
    ));
    logger.warn("Authorization: Bearer private-token");
    logger.info("Generated new staging user ID: 01234567-abcd-4000-8000-0123456789ab");
    const contents = readFileSync(logPath, "utf8");
    assert.match(contents, /\[info\].*Desktop update 0\.1\.6 is available/);
    assert.match(contents, /\[error\].*HTTP 403 from https:\/\/example\.test\/latest\.yml/);
    assert.doesNotMatch(contents, /password|signed-value|private-response|private-token|01234567/);
  } finally {
    rmSync(logDirectory, { recursive: true, force: true });
  }
  console.log("test-desktop-updater: all assertions passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
