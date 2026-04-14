import { spawn } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateToken, validateToken } from "./auth";
import { getConfig } from "./config";
import { createHttpHandler } from "./http";
import { SessionRegistry } from "./sessions";
import { SubmissionStore } from "./submissions";
import { WebSocketHub, type WsData } from "./websocket";

const config = getConfig(Bun.env);
const token = config.noAuth ? "" : (config.token ?? generateToken());

const registry = new SessionRegistry();
const submissions = new SubmissionStore(config.submissionsDir, config.maxSubmissionBytes);
// The hub's ShutdownFn type is synchronous, but initiateShutdown is async
// because it needs to await state-file cleanup. Fire-and-forget is safe here:
// initiateShutdown runs to process.exit(0), so no floating promise survives
// the process lifetime.
const hub = new WebSocketHub(registry, submissions, config, (opts) => {
  void initiateShutdown(opts);
});
const httpHandler = createHttpHandler(config.clientDir);

const server = Bun.serve<WsData>({
  hostname: config.host,
  port: config.port,

  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/canvas" || url.pathname === "/bridge") {
      if (!config.noAuth) {
        const provided = url.searchParams.get("token");
        if (!validateToken(provided, token)) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      const kind: WsData["kind"] = url.pathname === "/bridge" ? "bridge" : "browser";
      const upgraded = server.upgrade(req, {
        data: {
          kind,
          id: crypto.randomUUID(),
          lastHeartbeat: Date.now(),
        } as WsData,
      });

      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return httpHandler(req);
  },

  websocket: {
    maxPayloadLength: config.maxWsPayloadBytes,

    open(ws) {
      if (ws.data.kind === "browser") hub.addBrowser(ws);
      else hub.addBridge(ws);
    },

    async message(ws, msg) {
      await hub.handleMessage(ws, msg);
    },

    close(ws) {
      if (ws.data.kind === "browser") hub.removeBrowser(ws);
      else hub.removeBridge(ws);
    },
  },
});

// Write state file
const actualPort = server.port;
const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;
const stateUrl = config.noAuth
  ? `http://${displayHost}:${actualPort}`
  : `http://${displayHost}:${actualPort}?token=${token}`;

await mkdir(dirname(config.stateFile), { recursive: true });
await writeFile(
  config.stateFile,
  JSON.stringify(
    {
      pid: process.pid,
      port: actualPort,
      host: config.host,
      token: config.noAuth ? null : token,
      url: stateUrl,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

console.log(`[trayce] Server running on port ${actualPort}`);
console.log(`[trayce] Open: ${stateUrl}`);

// Intervals
const heartbeatTimer = setInterval(() => hub.checkHeartbeats(), config.heartbeatIntervalMs);
const cleanupTimer = setInterval(async () => {
  try {
    const removed = await submissions.cleanup(config.submissionTtlMs);
    if (removed > 0) console.log(`[trayce] Cleaned up ${removed} expired submission(s)`);
  } catch (err) {
    console.error("[trayce] Cleanup error:", err);
  }
}, config.cleanupIntervalMs);

// WS-initiated shutdown / restart
async function initiateShutdown({
  restart,
  containerMode,
}: {
  restart: boolean;
  containerMode: boolean;
}): Promise<void> {
  console.log(`[trayce] ${restart ? "restart" : "shutdown"} requested via WS`);
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  server.stop(true); // releases port 9740
  try {
    await unlink(config.stateFile);
  } catch {}
  submissions.removeAll();

  if (restart && !containerMode) {
    // Spawn a fully detached child with the current token so the browser's
    // reconnect-with-backoff picks up the new server seamlessly. Use
    // node:child_process.spawn (not Bun.spawn) because on Windows the child
    // dies with the parent unless we get true process-group detachment.
    try {
      const child = spawn(process.execPath, ["run", "scripts/start.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, TRAYCE_TOKEN: token },
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      console.log(`[trayce] spawned replacement server; parent PID ${process.pid} exiting`);
    } catch (err) {
      console.error("[trayce] failed to spawn replacement server:", err);
    }
  }
  // Container mode or plain shutdown: just exit. If the container has a
  // restart policy, the orchestrator relaunches us; otherwise the container
  // stops.
  process.exit(0);
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`[trayce] ${signal} — shutting down`);
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  server.stop(true);
  submissions.removeAll();
  try {
    await unlink(config.stateFile);
  } catch {}
  process.exit(0);
}

if (process.platform !== "win32") {
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
