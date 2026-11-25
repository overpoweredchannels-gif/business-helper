export interface DesktopUpdateStatus {
  currentVersion: string;
  phase: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "installing" | "error" | "unavailable";
  promptOpen: boolean;
  updateVersion?: string;
  progress?: number;
  transferredBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  estimatedSecondsRemaining?: number;
}

export interface DesktopUpdateCheckResult {
  isUpdateAvailable: boolean;
  versionInfo: { version: string } | null;
}

export interface DesktopUpdaterBridge {
  getStatus(): Promise<DesktopUpdateStatus>;
  getVersion(): Promise<string>;
  checkForUpdates(): Promise<DesktopUpdateCheckResult>;
  openInstallPrompt(): Promise<void>;
  dismissInstallPrompt(): Promise<void>;
  installUpdate(): Promise<void>;
  onStatusChanged(handler: (status: DesktopUpdateStatus) => void): () => void;
}
