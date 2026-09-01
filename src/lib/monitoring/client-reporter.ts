export type ClientErrorPayload = {
  message: string;
  stack?: string | null;
  path: string;
  kind: "error" | "unhandled_rejection";
};

const reported = new Map<string, number>();

export function reportClientRuntimeError(payload: ClientErrorPayload) {
  try {
    const key = `${payload.kind}|${payload.message}|${payload.path}`;
    const now = Date.now();
    if (now - (reported.get(key) ?? 0) < 60_000) return;
    reported.set(key, now);

    void import("@/lib/tradeos/authorized-fetch")
      .then(({ authorizedFetch }) =>
        authorizedFetch("/api/monitoring/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        })
      )
      .catch(() => undefined);
  } catch {
    // Monitoring must never interfere with the application.
  }
}
