export interface DesktopUpdateStatus {
  currentVersion: string;
  phase: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "installing" | "error" | "unavailable";
  promptOpen: boolean;
  updateVersion?: string;
  progress?: number;
  estimatedSecondsRemaining?: number;
}

export interface DesktopUpdaterBridge {
  getStatus(): Promise<DesktopUpdateStatus>;
  checkForUpdates(): Promise<void>;
  openInstallPrompt(): Promise<void>;
  dismissInstallPrompt(): Promise<void>;
  installUpdate(): Promise<void>;
  onStatusChanged(handler: (status: DesktopUpdateStatus) => void): () => void;
}
