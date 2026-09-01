import type { Instrumentation } from "next";
import { reportProductionError } from "@/lib/monitoring/error-reporter";

export function register() {
  // Next.js requires this export to initialize instrumentation. Runtime error
  // reporting is implemented by onRequestError below.
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : null;
  await reportProductionError({
    source: "server",
    message: normalizedError.message,
    stack: normalizedError.stack,
    digest,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
