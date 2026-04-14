/**
 * Cross-platform server status script (parallel to scripts/status.sh for
 * Windows compatibility). Reads state file and checks liveness of server PID.
 * Output: one JSON line on stdout; exit code 0 in all non-error cases so
 * callers (skills) can parse the result cleanly.
 */
import { existsSync, readFileSync } from "node:fs";
import { defaultStateFile } from "../shared/paths";

const stateFile = process.env.TRAYCE_STATE_FILE ?? defaultStateFile();

if (!existsSync(stateFile)) {
  console.log(JSON.stringify({ running: false, reason: "no state file" }));
  process.exit(0);
}

let state: { pid?: number; url?: string; token?: string | null; port?: number };
try {
  state = JSON.parse(readFileSync(stateFile, "utf-8"));
} catch {
  console.log(JSON.stringify({ running: false, reason: "corrupt state file" }));
  process.exit(0);
}

if (typeof state.pid !== "number") {
  console.log(JSON.stringify({ running: false, reason: "no pid in state file" }));
  process.exit(0);
}

try {
  process.kill(state.pid, 0);
} catch {
  console.log(
    JSON.stringify({ running: false, reason: `stale state — pid ${state.pid} not alive` }),
  );
  process.exit(0);
}

console.log(
  JSON.stringify({
    running: true,
    pid: state.pid,
    port: state.port,
    url: state.url ?? "",
    token: state.token ?? null,
  }),
);
