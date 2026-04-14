/**
 * Cross-platform server stop script (replaces stop.sh for Windows compatibility).
 * Reads state file, kills server process, cleans up.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { defaultStateFile } from "../shared/paths";

const stateFile = process.env.TRAYCE_STATE_FILE ?? defaultStateFile();

if (!existsSync(stateFile)) {
  console.log("No running trayce server found.");
  process.exit(0);
}

let pid: number | undefined;
try {
  const state = JSON.parse(readFileSync(stateFile, "utf-8"));
  pid = state.pid;
} catch {}

if (typeof pid !== "number") {
  console.log("Server not running. Cleaning up state file.");
  rmSync(stateFile, { force: true });
  process.exit(0);
}

// Check if alive and kill
try {
  process.kill(pid, 0); // Check alive
  process.kill(pid); // Default signal (SIGTERM on Unix, terminate on Windows)
  console.log(`Stopped trayce server (PID ${pid}).`);
} catch {
  console.log("Server not running. Cleaning up state file.");
}

rmSync(stateFile, { force: true });
