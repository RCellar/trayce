/**
 * Cross-platform server start script (replaces start.sh for Windows compatibility).
 * Checks for existing instance, builds client if needed, spawns server detached.
 * Output: JSON status on stdout.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { defaultLogFile, defaultStateFile } from "../shared/paths";

const stateFile = process.env.TRAYCE_STATE_FILE ?? defaultStateFile();
const projectRoot = resolve(import.meta.dir, "..");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPortBindable(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bindable = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, host);
    });
    if (bindable) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  // Timed out — don't throw; let the grandchild attempt the bind and log
  // its own error via the redirected stdio. That gives a precise failure
  // message (EADDRINUSE with the bind target) instead of a vague pre-flight.
}

// Check for existing instance
if (existsSync(stateFile)) {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    const pid = state.pid;
    if (typeof pid === "number" && isProcessAlive(pid)) {
      const url = state.url ?? "";
      console.log(JSON.stringify({ status: "existing", url, pid }));
      process.exit(0);
    }
  } catch {}
  // Stale state file — remove it
  try {
    rmSync(stateFile, { force: true });
  } catch {}
}

// Build client if needed
const clientEntry = resolve(projectRoot, "dist/client/app.js");
if (!existsSync(clientEntry)) {
  console.error("[trayce] Building client...");
  const build = Bun.spawnSync(["bun", "run", "build:client"], {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (build.exitCode !== 0) {
    console.error("[trayce] Client build failed");
    process.exit(1);
  }
}

// Start server detached
const serverEntry = resolve(projectRoot, "server/index.ts");
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
if (process.env.TRAYCE_TOKEN) {
  env.TRAYCE_TOKEN = process.env.TRAYCE_TOKEN;
}

// Wait until the target port is bindable. On Windows after a restart the old
// server's socket can linger in TIME_WAIT; if the grandchild races to bind
// too early it crashes with EADDRINUSE into a silent log. Poll by attempting
// a real bind/unbind rather than a connect probe — TIME_WAIT rejects binds
// but still accepts connects, so a connect probe is not diagnostic.
const targetPort = Number(env.TRAYCE_PORT ?? "9740");
const targetHost = env.TRAYCE_HOST ?? "0.0.0.0";
await waitForPortBindable(targetHost, targetPort, 5_000);

// Redirect stdio to a log file rather than "ignore" — errors from the
// grandchild (bind failures, missing modules, runtime crashes) otherwise
// disappear into the bit bucket. Append mode keeps history across restarts.
const logPath = defaultLogFile();
mkdirSync(dirname(logPath), { recursive: true });
const logFd = openSync(logPath, "a");

// Use node:child_process.spawn (not Bun.spawn) for detachment. `detached: true`
// on Windows starts the child in its own process group so it survives parent
// exit; `unref()` removes the child from our event loop so start.ts can exit
// promptly. This is the canonical cross-platform detachment pattern.
const child = spawn(process.execPath, ["run", serverEntry], {
  cwd: projectRoot,
  env,
  detached: true,
  stdio: ["ignore", logFd, logFd],
});
child.unref();

// Wait for state file (up to 10s)
const deadline = Date.now() + 10_000;
let state: { url?: string; pid?: number } | null = null;
while (Date.now() < deadline) {
  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, "utf-8"));
      if (state && typeof state.pid === "number") break;
      state = null;
    } catch {}
  }
  Bun.sleepSync(100);
}

if (state?.pid) {
  console.log(JSON.stringify({ status: "new", url: state.url ?? "", pid: state.pid }));
  // Explicit exit: the spawned server is now the state-file owner;
  // start.ts has no further work and the unref'd child must not keep us alive.
  process.exit(0);
} else {
  console.error(JSON.stringify({ status: "error", message: "Server failed to start" }));
  process.exit(1);
}
