import { reportClientRuntimeError } from "@/lib/monitoring/client-reporter";

window.addEventListener("error", (event) => {
  reportClientRuntimeError({
    kind: "error",
    message: event.error instanceof Error ? event.error.message : event.message || "Client error",
    stack: event.error instanceof Error ? event.error.stack : null,
    path: window.location.pathname,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  reportClientRuntimeError({
    kind: "unhandled_rejection",
    message: reason instanceof Error ? reason.message : String(reason ?? "Unhandled rejection"),
    stack: reason instanceof Error ? reason.stack : null,
    path: window.location.pathname,
  });
});

export function onRouterTransitionStart() {
  // Exported so Next.js can attach the instrumentation module to router
  // transitions; error listeners are registered once at module initialization.
}
