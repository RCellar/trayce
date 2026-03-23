import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

// Discover connection info from env or state.json
const stateFile = process.env.TRAYCE_STATE_FILE ?? "/tmp/trayce/state.json";
let host = process.env.TRAYCE_HOST ?? "";
let port = process.env.TRAYCE_PORT ?? "";
let token = process.env.TRAYCE_TOKEN ?? "";

if (existsSync(stateFile)) {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    if (!token) token = state.token ?? "";
    if (!port && state.port) port = String(state.port);
    if (!host) host = "localhost";
  } catch {
    // state file unreadable — continue with defaults
  }
}

if (!host) host = "localhost";
if (!port) port = "9740";

const label = process.env.TRAYCE_LABEL ?? basename(process.cwd());
const sessionId = crypto.randomUUID();

// MCP Channel server
const mcpServer = new Server(
  { name: "trayce", version: "1.0.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
    },
    instructions: `When you receive a trayce channel notification, read the PNG image at the provided path using the Read tool. The image is a hand-drawn sketch from the user. Treat the accompanying prompt text as the user's request about or relating to the sketch.`,
  }
);

// WebSocket connection to trayce server
const wsUrl = `ws://${host}:${port}/bridge?token=${encodeURIComponent(token)}`;
let reconnectDelay = 1000;

function connect() {
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    reconnectDelay = 1000;
    ws.send(JSON.stringify({ type: "register", sessionId, label }));

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
      } else {
        clearInterval(heartbeat);
      }
    }, 10_000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data));
      if (msg.type === "submission") {
        mcpServer.notification({
          method: "notifications/claude/channel",
          params: {
            content: msg.prompt || "[sketch submitted — see attached image]",
            meta: {
              image_path: msg.pngPath,
              submission_id: msg.id,
            },
          },
        });
      }
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };
}

connect();

// Start MCP stdio transport
const transport = new StdioServerTransport();
await mcpServer.connect(transport);
