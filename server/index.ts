import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { getConfig } from "./config";
import { generateToken, validateToken } from "./auth";
import { SessionRegistry } from "./sessions";
import { SubmissionStore } from "./submissions";
import { WebSocketHub, type WsData } from "./websocket";
import { createHttpHandler } from "./http";

const config = getConfig(Bun.env);
const token = config.noAuth ? "" : generateToken();

const registry = new SessionRegistry();
const submissions = new SubmissionStore(config.submissionsDir, config.maxSubmissionBytes);
const hub = new WebSocketHub(registry, submissions, config);
const httpHandler = createHttpHandler(config.clientDir);

const server = Bun.serve<WsData>({
  hostname: config.host,
  port: config.port,
  maxPayloadLength: config.maxWsPayloadBytes,

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
  JSON.stringify({
    pid: process.pid,
    port: actualPort,
    host: config.host,
    token: config.noAuth ? null : token,
    url: stateUrl,
  }, null, 2),
  { mode: 0o600 }
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

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`[trayce] ${signal} — shutting down`);
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  server.stop(true);
  submissions.removeAll();
  try { await unlink(config.stateFile); } catch {}
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
