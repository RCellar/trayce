import { tmpdir } from "node:os";
import { join } from "node:path";

/** Base directory for all trayce runtime files */
export function trayceDir(): string {
  return join(tmpdir(), "trayce");
}

/** Default submissions directory */
export function defaultSubmissionsDir(): string {
  return join(trayceDir(), "submissions");
}

/** Default state file path */
export function defaultStateFile(): string {
  return join(trayceDir(), "state.json");
}

/** Default server log path */
export function defaultLogFile(): string {
  return join(trayceDir(), "server.log");
}
