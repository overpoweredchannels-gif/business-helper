#!/usr/bin/env node
/**
 * AutoBridge — compute the next desktop release version.
 *
 * The AutoBridge publishes a new desktop release on every push to main.
 * electron-updater only offers an update when the release version is
 * HIGHER than the installed version, so each release needs a strictly
 * increasing version. This script derives it from the latest PUBLISHED
 * (non-draft, non-prerelease) GitHub release and increments the patch.
 *
 * Source of truth is the GitHub Releases API, NOT git tags: the repo has
 * old tags (e.g. v0.3.0) that never had a release, so the highest tag is
 * not the latest release. Only releases the updater can see count.
 *
 * Usage:
 *   node scripts/autobridge-next-version.mjs --repo owner/repo [--token TOKEN]
 *       [--latest vX.Y.Z] [--fallback X.Y.Z]
 *
 *   --repo       GitHub repo, e.g. overpoweredchannels-gif/business-helper.
 *                Defaults to $AUTOBRIDGE_REPO or the publish config in
 *                electron-builder.yml.
 *   --token      GitHub token for the API (env GITHUB_TOKEN). Required in CI;
 *                unauthenticated requests are rate-limited to 60/hour.
 *   --latest     Override the latest release tag (for local testing only;
 *                bypasses the API). E.g. --latest v0.1.0 -> prints 0.1.1.
 *   --fallback   Version to use when no release exists yet (default: the
 *                version field of package.json). The first release uses it
 *                as-is (not incremented).
 *
 * Output: prints the next version (e.g. 0.1.2) to stdout. When
 * $GITHUB_OUTPUT is set (GitHub Actions), also writes
 *   version=<next>  and  tag=v<next>
 * to it, so the workflow can use them.
 *
 * Exit codes: 0 = version computed; 1 = could not determine a version
 * (API failure, no token and rate-limited, malformed tag, ...). It NEVER
 * guesses: a wrong version could collide with an existing release or go
 * backwards, which would silently stop updates for installed users.
 */

import { readFileSync } from "node:fs";
import { appendFileSync } from "node:fs";

function parseArgs(argv) {
  const args = { repo: null, token: null, latest: null, fallback: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[++i];
    else if (a === "--token") args.token = argv[++i];
    else if (a === "--latest") args.latest = argv[++i];
    else if (a === "--fallback") args.fallback = argv[++i];
    else if (a.startsWith("--repo=")) args.repo = a.slice("--repo=".length);
    else if (a.startsWith("--token=")) args.token = a.slice("--token=".length);
    else if (a.startsWith("--latest=")) args.latest = a.slice("--latest=".length);
    else if (a.startsWith("--fallback=")) args.fallback = a.slice("--fallback=".length);
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function parseSemver(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function readRepoFromBuilderConfig() {
  try {
    const yml = readFileSync("electron-builder.yml", "utf8");
    const owner = /^\s*owner:\s*(\S+)\s*$/m.exec(yml)?.[1];
    const repo = /^\s*repo:\s*(\S+)\s*$/m.exec(yml)?.[1];
    if (owner && repo) return `${owner}/${repo}`;
  } catch {
    // Fall through to the error below.
  }
  return null;
}

function readVersionFromPackageJson() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (!pkg.version || !parseSemver(pkg.version)) {
    throw new Error(`package.json has no valid semver version: ${pkg.version}`);
  }
  return pkg.version;
}

async function fetchLatestReleaseTag(repo, token) {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=100`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aankh-autobridge",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub Releases API failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`
    );
  }
  const releases = await res.json();
  // Only releases the updater can see: published, not a prerelease.
  // Drafts are invisible to electron-updater and must not count.
  const published = releases.filter((r) => !r.draft && !r.prerelease);
  let best = null;
  for (const r of published) {
    const v = parseSemver(r.tag_name ?? "");
    if (!v) continue;
    if (!best || compareSemver(v, best) > 0) best = v;
  }
  return best ? `v${best.major}.${best.minor}.${best.patch}` : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo =
    args.repo ?? process.env.AUTOBRIDGE_REPO ?? readRepoFromBuilderConfig();
  if (!repo || !repo.includes("/")) {
    console.error(
      "cannot determine the GitHub repo: pass --repo owner/repo or set AUTOBRIDGE_REPO"
    );
    process.exit(1);
  }
  const token = args.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
  const fallback = args.fallback ?? readVersionFromPackageJson();

  let latestTag = args.latest ?? null;
  if (!latestTag) {
    try {
      latestTag = await fetchLatestReleaseTag(repo, token);
    } catch (err) {
      console.error(`::error::${err.message}`);
      console.error(
        "Refusing to guess a version: a collision or a backwards version would silently stop updates."
      );
      process.exit(1);
    }
  }

  let next;
  if (!latestTag) {
    // No published release yet — the first release uses the package.json
    // version as-is so it matches what the repo already calls itself.
    const v = parseSemver(fallback);
    if (!v) {
      console.error(`::error::fallback version is not semver: ${fallback}`);
      process.exit(1);
    }
    next = `${v.major}.${v.minor}.${v.patch}`;
  } else {
    const v = parseSemver(latestTag);
    if (!v) {
      console.error(`::error::latest release tag is not semver: ${latestTag}`);
      process.exit(1);
    }
    next = `${v.major}.${v.minor}.${v.patch + 1}`;
  }

  console.log(next);
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `version=${next}\n`);
    appendFileSync(out, `tag=v${next}\n`);
  }
}

main().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
