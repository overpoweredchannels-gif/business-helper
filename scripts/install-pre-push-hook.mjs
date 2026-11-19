#!/usr/bin/env node
/**
 * Installs the pre-push gate hook into the repo's git hooks directory.
 *
 * Run automatically by npm on `npm install` / `npm ci` via the `prepare`
 * script in package.json. Zero dependencies (Node stdlib only).
 *
 * The hook runs `node scripts/check-desktop-routes.mjs` and blocks the push
 * when the gate fails (e.g. a new /api route with no manifest entry). The
 * gate is stdlib-only and takes ~1s, so the hook stays fast. CI (the
 * "Desktop route classification gate" workflow) is only the last safety net
 * — this hook is the first line of defence for direct pushes to main.
 *
 * The installer NEVER fails the install: if git is unavailable, there is no
 * .git directory (a source tarball, a build environment without git), or the
 * write fails, it warns on stderr and exits 0. The hook itself fails closed
 * (the gate's exit code decides the push).
 *
 * If a DIFFERENT pre-push hook already exists, the installer leaves it
 * untouched and warns instead of overwriting it — a developer's own hook
 * is never silently replaced. Re-running the installer is idempotent: an
 * already-installed identical hook is left as-is.
 */

import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOOK = `#!/bin/sh
# Pre-push gate — auto-installed by \`npm install\` (scripts/install-pre-push-hook.mjs).
# Runs the desktop route classification gate; a failing gate blocks the push.
# CI ("Desktop route classification gate" workflow) is only the last safety net.
set -e
ROOT="$(git rev-parse --show-toplevel)"
exec node "$ROOT/scripts/check-desktop-routes.mjs"
`;

function warn(message) {
  console.warn(`[install-pre-push-hook] ${message}`);
}

try {
  const hooksDir = execSync("git rev-parse --git-path hooks", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  mkdirSync(hooksDir, { recursive: true });
  const target = join(hooksDir, "pre-push");
  if (existsSync(target) && readFileSync(target, "utf8") !== HOOK) {
    warn(
      `a different pre-push hook already exists at ${target} — leaving it untouched. ` +
        `Chain the gate manually: node scripts/check-desktop-routes.mjs`,
    );
    process.exit(0);
  }
  if (existsSync(target)) {
    console.log(`[install-pre-push-hook] pre-push gate hook already installed at ${target}`);
    process.exit(0);
  }
  writeFileSync(target, HOOK, { mode: 0o755 });
  chmodSync(target, 0o755);
  console.log(`[install-pre-push-hook] installed pre-push gate hook at ${target}`);
} catch (error) {
  warn(`could not install the pre-push hook (${error.message}); push will not be gated locally, CI remains the safety net.`);
  process.exit(0);
}
