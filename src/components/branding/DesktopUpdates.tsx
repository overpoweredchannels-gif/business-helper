"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { MessageKey } from "@/lib/regional/messages";
import { cn } from "@/lib/utils";
import type { DesktopUpdateStatus, DesktopUpdaterBridge } from "../../../electron/updater-types";

const PHASE_LABELS = {
  idle: "desktopUpdates.idle",
  checking: "desktopUpdates.checking",
  "up-to-date": "desktopUpdates.upToDate",
  available: "desktopUpdates.available",
  downloading: "desktopUpdates.downloading",
  installing: "desktopUpdates.installing",
  error: "desktopUpdates.error",
  unavailable: "desktopUpdates.unavailable",
} as const satisfies Record<DesktopUpdateStatus["phase"], MessageKey>;

type UpdateAction = Exclude<keyof DesktopUpdaterBridge, "getVersion" | "getStatus" | "onStatusChanged">;
type DesktopUpdatesValue = {
  status: DesktopUpdateStatus | null;
  runningVersion: string | null;
  pendingAction: UpdateAction | null;
  actionFailed: boolean;
  runAction: (action: UpdateAction) => Promise<void>;
};

const DesktopUpdatesContext = createContext<DesktopUpdatesValue | null>(null);

export function DesktopUpdatesProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<UpdateAction | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const actionPending = useRef(false);
  const statusRevision = useRef(0);

  useEffect(() => {
    const updater = window.aankhDesktop?.updater;
    if (!updater) return;

    let active = true;
    const initialRevision = statusRevision.current;
    const unsubscribe = updater.onStatusChanged((next) => {
      if (!active) return;
      statusRevision.current += 1;
      setStatus(next);
      setActionFailed(false);
    });
    // Listen before asking for the snapshot. A live event can arrive before
    // the snapshot resolves, in which case the event is newer.
    void updater.getStatus().then((snapshot) => {
      if (active && statusRevision.current === initialRevision) setStatus(snapshot);
    }).catch(() => { /* A later status event can still populate the panel. */ });
    void updater.getVersion().then((version) => {
      if (active && version) setRunningVersion(version);
    }).catch(() => { /* The update prompt can still work without the version label. */ });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const runAction = useCallback(async (action: UpdateAction) => {
    const updater = window.aankhDesktop?.updater;
    if (!updater || actionPending.current) return;
    actionPending.current = true;
    setPendingAction(action);
    setActionFailed(false);
    const revision = statusRevision.current;
    try {
      await updater[action]();
    } catch {
      if (statusRevision.current === revision) setActionFailed(true);
    } finally {
      actionPending.current = false;
      setPendingAction(null);
    }
  }, []);

  return (
    <DesktopUpdatesContext.Provider value={{ status, runningVersion, pendingAction, actionFailed, runAction }}>
      {children}
      {status && <DesktopUpdatePrompt status={status} runningVersion={runningVersion} pendingAction={pendingAction} actionFailed={actionFailed} runAction={runAction} />}
    </DesktopUpdatesContext.Provider>
  );
}

function getProgress(status: DesktopUpdateStatus): number | undefined {
  if (status.phase !== "downloading" || typeof status.progress !== "number" || !Number.isFinite(status.progress)) return;
  return Math.round(Math.max(0, Math.min(100, status.progress)));
}

function formatDownloadEstimate(seconds: number, language: string): string {
  const unit = seconds < 60 ? "second" : seconds < 3600 ? "minute" : "hour";
  const unitInSeconds = unit === "second" ? 1 : unit === "minute" ? 60 : 3600;
  return new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "long" }).format(Math.ceil(seconds / unitInSeconds));
}

function formatDownloadBytes(bytes: number, language: string, perSecond = false): string {
  const [unit, divisor] = bytes >= 1_000_000_000 ? ["gigabyte", 1_000_000_000] as const
    : bytes >= 1_000_000 ? ["megabyte", 1_000_000] as const
      : bytes >= 1_000 ? ["kilobyte", 1_000] as const : ["byte", 1] as const;
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: perSecond ? `${unit}-per-second` : unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / divisor);
}

function isNonnegativeNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function DesktopDownloadProgress({ status }: { status: DesktopUpdateStatus }) {
  const { t, language } = useRegional();
  const progress = getProgress(status);
  const { transferredBytes, totalBytes, bytesPerSecond, estimatedSecondsRemaining } = status;
  const transferred = isNonnegativeNumber(transferredBytes) ? formatDownloadBytes(transferredBytes, language) : "—";
  const downloaded = isNonnegativeNumber(totalBytes) && totalBytes > 0
    ? t("desktopUpdates.downloadedOf").replace("{transferred}", transferred).replace("{total}", formatDownloadBytes(totalBytes, language))
    : transferred;
  const speed = isNonnegativeNumber(bytesPerSecond) ? formatDownloadBytes(bytesPerSecond, language, true) : "—";
  const estimate = isNonnegativeNumber(bytesPerSecond) && bytesPerSecond > 0 && isNonnegativeNumber(estimatedSecondsRemaining)
    ? t("desktopUpdates.eta").replace("{time}", formatDownloadEstimate(estimatedSecondsRemaining, language))
    : t("desktopUpdates.estimating");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 text-sm font-medium">
        <span>{t("desktopUpdates.downloadProgress")}</span>
        {progress !== undefined && <bdi className="tabular-nums">{new Intl.NumberFormat(language, { style: "percent" }).format(progress / 100)}</bdi>}
      </div>
      <progress aria-label={t("desktopUpdates.downloadProgress")} max={100} value={progress} className="block h-2 w-full accent-primary" />
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{t("desktopUpdates.downloaded")}</dt>
          <dd className="font-medium tabular-nums">{downloaded}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("desktopUpdates.speed")}</dt>
          <dd className="font-medium tabular-nums"><bdi>{speed}</bdi></dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("desktopUpdates.timeRemaining")}</dt>
          <dd className="font-medium tabular-nums">{estimate}</dd>
        </div>
      </dl>
    </div>
  );
}

function DesktopUpdatePrompt({ status, runningVersion, pendingAction, actionFailed, runAction }: Omit<DesktopUpdatesValue, "status"> & {
  status: DesktopUpdateStatus;
}) {
  const { t } = useRegional();
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [saleBlocked, setSaleBlocked] = useState(false);
  const installing = status.phase === "installing";
  const busy = installing || status.phase === "downloading" || pendingAction === "installUpdate";
  const failed = status.phase === "error" || actionFailed;

  function dismissPrompt() {
    setSaleBlocked(false);
    void runAction("dismissInstallPrompt");
  }

  function confirmInstall() {
    if (!window.dispatchEvent(new Event("aankh:before-install-update", { cancelable: true }))) {
      setSaleBlocked(true);
      return;
    }
    setSaleBlocked(false);
    void runAction("installUpdate");
  }

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (status.promptOpen) {
      if (!element.open) element.showModal();
      // Consent requires an explicit action. Focus a non-interactive heading
      // on open and when the dialog switches to or from progress.
      heading.current?.focus();
    } else if (element.open) {
      element.close();
    }
  }, [busy, status.promptOpen]);

  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-context-help-skip
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && pendingAction === null) dismissPrompt();
      }}
      className={cn(
        "fixed inset-0 overflow-y-auto text-foreground backdrop:bg-foreground/50 print:hidden",
        busy
          ? "m-0 h-dvh max-h-none w-full max-w-none bg-background px-6 py-8"
          : "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8",
      )}
    >
      <div className={cn("space-y-5", busy && "mx-auto flex min-h-full max-w-xl flex-col justify-center")}>
        <div className="space-y-2">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="text-2xl font-semibold sm:text-3xl">
            {t(installing ? "desktopUpdates.installingTitle" : busy ? "desktopUpdates.downloadingTitle" : "desktopUpdates.title")}
          </h2>
          {status.updateVersion && (
            <p className="break-words text-3xl font-semibold tabular-nums text-primary sm:text-4xl">
              <span className="sr-only">{t("desktopUpdates.newVersion")} </span>
              <bdi>v{status.updateVersion}</bdi>
            </p>
          )}
          {runningVersion && <p className="text-sm text-muted-foreground"><span>{t("desktopUpdates.currentVersion")} </span><bdi>v{runningVersion}</bdi></p>}
        </div>
        <div id={descriptionId} aria-live="polite" className="space-y-2 text-sm text-muted-foreground">
          {!busy && <p>{t("desktopUpdates.saveWork")}</p>}
          <p>{t(installing ? "desktopUpdates.reopening" : "desktopUpdates.restartHint")}</p>
        </div>
        {busy && !installing && <DesktopDownloadProgress status={status} />}
        {!busy && (saleBlocked || failed) && (
          <p role="alert" className="text-sm text-destructive">{t(saleBlocked ? "desktopUpdates.saleBlocked" : "desktopUpdates.error")}</p>
        )}
        {!busy && (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={pendingAction !== null} onClick={dismissPrompt} className="min-h-11 min-w-11 rounded-lg border border-input px-4 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              {t(failed && !saleBlocked ? "desktopUpdates.close" : "desktopUpdates.later")}
            </button>
            <button type="button" disabled={pendingAction !== null} onClick={confirmInstall} className="min-h-11 min-w-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              {t(failed ? "desktopUpdates.retryInstall" : "desktopUpdates.install")}
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}

export function DesktopUpdates({ surface, collapsed = false }: {
  surface: "dashboard" | "sidebar" | "footer";
  collapsed?: boolean;
}) {
  const updates = useContext(DesktopUpdatesContext);
  const { t } = useRegional();
  if (!updates?.status || !updates.runningVersion) return null;

  const { status, runningVersion, pendingAction, actionFailed, runAction } = updates;
  const version = `v${runningVersion}`;
  const phase = pendingAction === "checkForUpdates"
    ? "checking"
    : actionFailed ? "error" : status.phase;
  const updateVersion = status.updateVersion ? ` \u2066v${status.updateVersion}\u2069` : "";
  const phaseText = t(PHASE_LABELS[phase]).replace("{version}", updateVersion);
  const progress = getProgress(status);
  const canReview = phase === "available" || (phase === "error" && Boolean(status.updateVersion));
  const canCheck = canReview || phase === "idle" || phase === "up-to-date" || phase === "error";
  const onDarkPanel = surface === "dashboard" && !collapsed;

  const details = (
    <>
      {!collapsed && <p className="font-semibold"><bdi>{version}</bdi></p>}
      <p role={collapsed ? undefined : "status"} aria-atomic={collapsed ? undefined : true}>{phaseText}</p>
      {progress !== undefined && <p className="tabular-nums"><bdi>{progress}%</bdi></p>}
      <button
        type="button"
        disabled={!canCheck || pendingAction !== null}
        onClick={() => void runAction(canReview ? "openInstallPrompt" : "checkForUpdates")}
        className={cn(
          "min-h-11 min-w-11 rounded-md px-2 text-xs font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 disabled:no-underline",
          onDarkPanel ? "text-primary-on-dark focus-visible:ring-primary-on-dark" : "text-primary focus-visible:ring-ring",
        )}
      >
        {t(canReview ? "desktopUpdates.review" : phase === "error" ? "desktopUpdates.retry" : "desktopUpdates.check")}
      </button>
    </>
  );

  if (collapsed) {
    return (
      <div data-desktop-updates-sidebar="" className="-mx-2">
        <span className="sr-only" role="status" aria-atomic="true">{phaseText}</span>
        <details className="relative">
          <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg px-1 text-[11px] font-semibold tabular-nums text-panel-foreground hover:bg-nav-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark">
            <span className="sr-only">{t("desktopUpdates.details")} </span>
            <bdi className="break-all">{version}</bdi>
          </summary>
          <div className="absolute bottom-0 start-full z-40 ms-2 w-56 space-y-1 rounded-lg border border-border bg-card p-3 text-xs text-foreground shadow-lg">
            {details}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div
      data-desktop-updates-sidebar={surface !== "footer" ? "" : undefined}
      className={cn(
        "space-y-1 break-words px-2 pt-2 text-xs",
        onDarkPanel ? "text-panel-foreground" : "text-foreground",
        surface === "footer" && "lg:[body:has([data-desktop-updates-sidebar])_&]:hidden",
      )}
    >
      {details}
    </div>
  );
}
