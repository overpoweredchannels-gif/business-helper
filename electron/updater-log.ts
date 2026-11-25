import electronLog from "electron-log/node";

export function createUpdaterLogger(logPath: string) {
  const logger = electronLog.create({ logId: "aankh-updater" });
  logger.transports.file.resolvePathFn = () => logPath;
  logger.transports.file.maxSize = 256 * 1024;
  if (logger.transports.ipc) logger.transports.ipc.level = false;
  logger.transports.remote.level = false;

  logger.hooks.push((message) => ({
    ...message,
    data: message.data.map((value: unknown) => {
      const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
      // The SDK can append HTTP bodies, headers, and stacks after the summary.
      const [summary] = text.split(/\r?\n/, 1);
      return summary
        .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
          try {
            const { origin, pathname } = new URL(url);
            return `${origin}${pathname}`;
          } catch {
            return "[URL omitted]";
          }
        })
        .replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, "$1 [redacted]")
        .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi, "[identifier omitted]");
    }),
  }));
  return logger;
}
