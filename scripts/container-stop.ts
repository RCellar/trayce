/**
 * Cross-platform container stop script (replaces container-stop.sh).
 * Detects podman/docker, stops trayce container via compose.
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

const runtime = detectRuntime();

// Check if running
const ps = Bun.spawnSync(
  [runtime, "ps", "--filter", `name=^${containerName}$`, "--format", "{{.Names}}"],
  { stdout: "pipe", stderr: "ignore" },
);
const output = ps.stdout.toString().trim();

if (!output.includes(containerName)) {
  console.log("No running trayce container found.");
  process.exit(0);
}

Bun.spawnSync([runtime, "compose", "down"], {
  cwd: projectDir,
  stdio: ["ignore", "inherit", "inherit"],
});
console.log("Stopped trayce container.");
