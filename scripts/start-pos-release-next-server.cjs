const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
let next;

const nativeStderrWrite = process.stderr.write.bind(process.stderr);
let startupComplete = false;
let startupErrorEmitted = false;
const startupDiagnostics = [];

function startupError(error) {
  if (startupErrorEmitted) return;
  startupErrorEmitted = true;
  let message = error && typeof error.message === "string" ? error.message : String(error);
  for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY]) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  message = message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+\b/g, "[REDACTED_JWT]")
    .replace(/\s+/g, " ")
    .slice(0, 800);
  const captured = startupDiagnostics.slice(-8).join(" | ").slice(0, 1000);
  const code = error && typeof error.code === "string" ? ` code=${error.code}` : "";
  nativeStderrWrite(`POS_TEST_NEXT_STARTUP_ERROR${code} ${message}${captured ? ` | child stderr/stdout: ${captured}` : ""}\n`);
}

function captureStartupWrite(chunk, encoding, callback) {
  let text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
  for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY]) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  text = text
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+\b/g, "[REDACTED_JWT]")
    .replace(/\s+/g, " ")
    .slice(0, 300);
  if (!startupComplete && text) {
    startupDiagnostics.push(text);
    if (startupDiagnostics.length > 20) startupDiagnostics.shift();
  }
  const done = typeof encoding === "function" ? encoding : callback;
  if (typeof done === "function") done();
  return true;
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", command => {
  if (command.includes("PREFLIGHT_SUCCESS")) startupComplete = true;
  if (command.includes("DUMP_STARTUP_DIAGNOSTICS")) {
    const captured = startupDiagnostics.slice(-12).join(" | ").slice(0, 1800);
    nativeStderrWrite(`POS_TEST_NEXT_STARTUP_DIAGNOSTICS ${captured || "No Next startup diagnostics were emitted."}\n`);
  }
});

// Keep the detached server quiet. Startup failures are emitted below after
// sanitization; ordinary Next logs never receive credentials or enter files.
process.stdout.write = captureStartupWrite;
process.stderr.write = captureStartupWrite;
process.on("exit", code => {
  if (!startupComplete && code !== 0 && !startupErrorEmitted) {
    startupError({ message: `Next.js startup exited with code ${code}` });
  }
});

function prepareIsolatedProject() {
  const sourceRoot = process.cwd();
  const projectRoot = process.env.POS_TEST_NEXT_PROJECT_ROOT;
  if (!projectRoot) {
    throw new Error("The isolated Next project path is not configured.");
  }
  const allowedRoot = path.resolve(sourceRoot, ".next");
  const isolatedRoot = path.resolve(projectRoot);
  const relativePath = path.relative(allowedRoot, isolatedRoot);
  if (!relativePath.startsWith("pos-release-next-") || relativePath.includes(path.sep) || path.isAbsolute(relativePath)) {
    throw new Error("The isolated Next project path is outside the ignored build cache.");
  }
  if (fs.existsSync(isolatedRoot)) {
    throw new Error("The unique isolated Next project directory already exists.");
  }

  fs.mkdirSync(isolatedRoot, { recursive: true });
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "next-env.d.ts", "postcss.config.mjs", ".gitignore"]) {
    const source = path.join(sourceRoot, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(isolatedRoot, file));
  }
  for (const directory of ["src", "public"]) {
    const source = path.join(sourceRoot, directory);
    if (!fs.existsSync(source)) throw new Error(`Required project directory is missing: ${directory}.`);
    fs.cpSync(source, path.join(isolatedRoot, directory), { recursive: true, dereference: true });
  }
  // Share installed packages while keeping all compiled output private to this
  // per-run project root. The application source itself is copied so Turbopack
  // never resolves a source symlink outside its filesystem root.
  const modules = path.join(sourceRoot, "node_modules");
  if (!fs.existsSync(modules)) throw new Error("Required project directory is missing: node_modules.");
  fs.symlinkSync(modules, path.join(isolatedRoot, "node_modules"), "junction");

  // Next's custom-server API reads these base development manifests before its
  // first compile. Seed the generated metadata only; never copy the live dev
  // lock or compiled application output from the port-3000 server.
  const sourceDevDir = path.join(sourceRoot, ".next", "dev");
  const isolatedDevDir = path.join(isolatedRoot, ".next", "dev");
  fs.mkdirSync(isolatedDevDir, { recursive: true });
  for (const file of ["build-manifest.json", "fallback-build-manifest.json", "prerender-manifest.json", "routes-manifest.json"]) {
    const source = path.join(sourceDevDir, file);
    if (!fs.existsSync(source)) throw new Error(`Required generated Next manifest is missing: .next/dev/${file}.`);
    fs.copyFileSync(source, path.join(isolatedDevDir, file));
  }
  return isolatedRoot;
}

(async () => {
  const port = 3001;
  const projectRoot = prepareIsolatedProject();
  next = require("next");
  const app = next({
    dev: true,
    dir: projectRoot,
    hostname: "127.0.0.1",
    port,
  });
  await app.prepare();
  const server = http.createServer(app.getRequestHandler());
  server.on("upgrade", app.getUpgradeHandler());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
})().catch(error => {
  startupError(error);
  process.exitCode = 1;
});
