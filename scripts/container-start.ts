/**
 * Cross-platform container start script (replaces container-start.sh).
 * Detects podman/docker, checks for existing container, starts with compose.
 */
import { resolve } from "node:path";

const projectDir = resolve(import.meta.dir, "..");
const containerName = "trayce";

function detectRuntime(): string {
  for (const runtime of ["podman", "docker"]) {
    const result = Bun.spawnSync([runtime, "--version"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    if (result.exitCode === 0) return runtime;
  }
  console.error("Error: Neither podman nor docker found.");
  process.exit(1);
}

function run(cmd: string[], opts?: { cwd?: string; capture?: boolean }): { stdout: string; exitCode: number } {
  const result = Bun.spawnSync(cmd, {
    cwd: opts?.cwd ?? projectDir,
    stdout: opts?.capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  return {
    stdout: opts?.capture ? result.stdout.toString().trim() : "",
    exitCode: result.exitCode ?? 1,
  };
}

const runtime = detectRuntime();

// Check if container is already running
const ps = run([runtime, "ps", "--filter", `name=^${containerName}$`, "--format", "{{.Names}}"], { capture: true });
if (ps.stdout.includes(containerName)) {
  // Get port mapping
  const portResult = run([runtime, "port", containerName, "9740"], { capture: true });
  const portMatch = portResult.stdout.match(/:(\d+)/);
  const port = portMatch ? portMatch[1] : "9740";
  let url = `http://localhost:${port}`;
  if (process.env.TRAYCE_TOKEN) {
    url += `?token=${process.env.TRAYCE_TOKEN}`;
  }
  console.log(JSON.stringify({ status: "existing", url, container: containerName }));
  process.exit(0);
}

// Start with compose
console.error(`[trayce] Starting container with ${runtime} compose...`);
const up = run([runtime, "compose", "up", "-d", "--build"]);
if (up.exitCode !== 0) {
  console.error(JSON.stringify({ status: "error", message: "compose up failed" }));
  process.exit(1);
}

// Wait for health check (up to 30s)
console.error("[trayce] Waiting for health check...");
let status = "starting";
for (let i = 0; i < 30; i++) {
  const inspect = run(
    [runtime, "inspect", "--format", "{{.State.Health.Status}}", containerName],
    { capture: true },
  );
  status = inspect.stdout || "starting";
  if (status === "healthy") break;
  Bun.sleepSync(1000);
}

if (status !== "healthy") {
  console.error(JSON.stringify({ status: "error", message: `Container not healthy after 30s (status: ${status})` }));
  process.exit(1);
}

// Get port
const portResult = run([runtime, "port", containerName, "9740"], { capture: true });
const portMatch = portResult.stdout.match(/:(\d+)/);
const port = portMatch ? portMatch[1] : "9740";
let url = `http://localhost:${port}`;
if (process.env.TRAYCE_TOKEN) {
  url += `?token=${process.env.TRAYCE_TOKEN}`;
}

console.log(JSON.stringify({ status: "new", url, container: containerName }));
