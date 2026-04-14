/**
 * Cross-platform container image build script (replaces build-image.sh).
 * Detects podman/docker and builds the trayce image.
 */
import { resolve } from "node:path";

const projectDir = resolve(import.meta.dir, "..");

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

console.log(`Building trayce image with ${runtime}...`);
const result = Bun.spawnSync([runtime, "build", "-t", "trayce:latest", "."], {
  cwd: projectDir,
  stdio: ["ignore", "inherit", "inherit"],
});

if (result.exitCode !== 0) {
  console.error("Build failed.");
  process.exit(1);
}

console.log("Done. Image: trayce:latest");
