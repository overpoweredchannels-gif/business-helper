// compare-lint-baseline.mjs — compare an eslint JSON report for
// src/app/page.tsx against the committed baseline (.github/lint-baseline.json).
//
// Gate (Claude msg 46): FAIL if any error key is not in the baseline, and
// FAIL if total warnings exceed the baseline. The 5 known errors and
// <= baseline warnings PASS.
//
// Error keys are LINE-INSENSITIVE: {file, ruleId, message, enclosingFunction}
// — no line or column numbers. That matters because the eslint `message`
// itself embeds a location line plus a source code frame, which shifts on
// every edit; normalizeMessage() strips that volatile tail and keeps only
// the stable heading + description.
//
// Usage:
//   node .github/scripts/compare-lint-baseline.mjs [lint-report.json] [.github/lint-baseline.json]
// Exit 0 = pass, 1 = fail (unknown error key, warnings over baseline,
// missing/unreadable report or baseline).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PAGE_PATH = "src/app/page.tsx";

// Best-effort enclosing-function lookup for the baseline key:
// nearest function-like declaration above the reported line.
// MUST stay identical to the "Print lint summary" step in
// .github/workflows/ci-lint-page.yml.
function enclosingFunction(src, lineNo) {
  for (let i = lineNo - 1; i >= 0; i--) {
    const line = src[i];
    let m = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (m) return m[1];
    m = line.match(/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(/);
    if (m) return m[1];
    m = line.match(/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*use(?:Callback|Memo)\s*\(/);
    if (m) return m[1];
    m = line.match(/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
    if (m) return m[1];
  }
  return "(top level)";
}

// A raw eslint message from the React Compiler preset is:
//   <heading>: <reason>\n\n<description>.\n\n<file>:<line>:<column>\n<code frame>
// The location line + code frame shift on every edit, so drop every
// paragraph that opens with a `<file>:<line>:<column>` location line and
// keep the stable heading + description. (Assumption: a description
// paragraph never itself opens with a location line.)
function normalizeMessage(raw) {
  const paragraphs = String(raw ?? "").split(/\n\s*\n/);
  const stable = paragraphs.filter((p) => {
    const firstLine = p.split("\n")[0] ?? "";
    return !/^.+:\d+:\d+$/.test(firstLine.trim());
  });
  return stable.join("\n\n").trim();
}

function toRepoRelative(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join("/");
  }
  // Absolute path outside the checkout (e.g. a different runner layout):
  // strip leading segments until the remainder resolves to a file inside
  // the checkout, longest match first.
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join("/");
    if (fs.existsSync(path.join(process.cwd(), candidate))) return candidate;
  }
  return rel.split(path.sep).join("/");
}

function keyString(key) {
  return JSON.stringify([
    key.file,
    key.ruleId,
    key.message,
    key.enclosingFunction,
  ]);
}

function deriveErrorKeys(report, src) {
  const keys = [];
  let errors = 0;
  let warnings = 0;
  for (const file of report) {
    errors += file.errorCount ?? 0;
    warnings += file.warningCount ?? 0;
    for (const msg of file.messages ?? []) {
      if (msg.severity !== 2) continue;
      keys.push({
        file: toRepoRelative(file.filePath),
        ruleId: msg.ruleId ?? "no-rule",
        message: normalizeMessage(msg.message),
        enclosingFunction: enclosingFunction(src, msg.line),
      });
    }
  }
  return { keys, errors, warnings };
}

function compare(report, baseline, src) {
  const { keys, errors, warnings } = deriveErrorKeys(report, src);
  const allowed = new Set(
    (baseline.allowed_errors ?? []).map((k) => keyString(k)),
  );
  const unknownErrors = keys.filter((k) => !allowed.has(keyString(k)));
  const warningsOver = warnings > (baseline.baseline_warnings ?? 0);
  return {
    errors,
    warnings,
    allowedCount: baseline.allowed_errors?.length ?? 0,
    baselineWarnings: baseline.baseline_warnings ?? 0,
    unknownErrors,
    warningsOver,
    passed: unknownErrors.length === 0 && !warningsOver,
  };
}

function main() {
  const reportPath = process.argv[2] ?? "lint-report.json";
  const baselinePath = process.argv[3] ?? ".github/lint-baseline.json";

  if (!fs.existsSync(reportPath)) {
    console.error(
      `::error::${reportPath} not found — eslint did not produce a report.`,
    );
    process.exit(1);
  }
  if (!fs.existsSync(baselinePath)) {
    console.error(`::error::${baselinePath} not found — no baseline to compare against.`);
    process.exit(1);
  }
  if (!fs.existsSync(PAGE_PATH)) {
    console.error(
      `::error::${PAGE_PATH} not found — run from the repository root.`,
    );
    process.exit(1);
  }

  let report;
  let baseline;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (e) {
    console.error(`::error::could not parse ${reportPath}: ${e.message}`);
    process.exit(1);
  }
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch (e) {
    console.error(`::error::could not parse ${baselinePath}: ${e.message}`);
    process.exit(1);
  }

  const src = fs.readFileSync(PAGE_PATH, "utf8").split("\n");
  const result = compare(report, baseline, src);

  console.log(
    `Errors: ${result.errors} (allowed known: ${result.allowedCount}) | Warnings: ${result.warnings} (baseline: ${result.baselineWarnings})`,
  );
  if (result.unknownErrors.length > 0) {
    console.log(
      `::error::${result.unknownErrors.length} new error key(s) not in the baseline:`,
    );
    for (const k of result.unknownErrors) {
      console.log(
        `  - ${k.file} [${k.ruleId}] (in ${k.enclosingFunction}): ${k.message.split("\n")[0]}`,
      );
    }
  }
  if (result.warningsOver) {
    console.log(
      `::error::warnings ${result.warnings} exceed baseline ${result.baselineWarnings}`,
    );
  }
  if (result.passed) {
    console.log("PASS: no new error keys, warnings within baseline.");
    process.exit(0);
  } else {
    console.log(
      "FAIL: lint differs from baseline — see new error keys / warning count above.",
    );
    process.exit(1);
  }
}

export { normalizeMessage, enclosingFunction, deriveErrorKeys, compare };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
