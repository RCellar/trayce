# Architecture & Data Flow

Trayce runs as three cooperating processes connected by WebSocket and MCP stdio:

```
                        +-----------------------+
                        |    TRAYCE SERVER      |
                        |    (Bun, port 9740)   |
                        |                       |
                        |  HTTP ── WS Hub ──    |
                        |  (static   (routes    |
                        |   files)   messages)  |
                        +---------+---+---------+
                                  |   |
                   +--------------+   +--------------+
                   |                                  |
          /canvas WebSocket                  /bridge WebSocket
                   |                                  |
        +----------+----------+            +----------+----------+
        |   BROWSER CLIENT    |            |   MCP BRIDGE        |
        |                     |            |   (per Claude        |
        |  PixiJS canvas      |            |    session)          |
        |  Brush engine       |            |                     |
        |  Layer compositor   |            |  WS client          |
        |  Session selector   |            |  MCP Channel server |
        +---------------------+            +----------+----------+
                                                      |
                                               stdio (MCP)
                                                      |
                                           +----------+----------+
                                           |   CLAUDE CODE       |
                                           |                     |
                                           |  Reads PNG from     |
                                           |  disk path          |
                                           +---------------------+
```

## The Three Processes

### Server (`server/`)

Long-lived Bun HTTP + WebSocket server on port 9740. Serves the client SPA via HTTP, manages WebSocket connections from both browsers (`/canvas`) and bridges (`/bridge`), saves submissions as PNG files to disk, and writes a state file (`/tmp/trayce/state.json`) for service discovery.

Key modules:
- `config.ts` — All config from env vars with defaults
- `auth.ts` — Token generation and timing-safe validation
- `sessions.ts` — In-memory session registry with label deduplication
- `submissions.ts` — Disk-backed PNG store with TTL cleanup (1 hour)
- `websocket.ts` — WebSocket hub: routing, rate limiting, heartbeat timeouts
- `http.ts` — Static file serving for the client SPA
- `usage.ts` — Token usage and cost aggregation from bridge transcript events

### Bridge (`bridge/`)

Spawned per Claude Code session as an MCP subprocess. Reads `state.json` to discover the server, connects via WebSocket, registers its session, and forwards submissions as MCP channel notifications to Claude. Also watches Claude's transcript file for live updates and relays usage/cost data.

- `index.ts` — MCP server setup, `push_image` tool, WebSocket connection, message routing
- `transcript-watcher.ts` — Watches Claude's JSONL transcript for tool calls, responses, and usage data

### Client (`client/`)

Browser-based canvas painting app built with PixiJS and perfect-freehand. Bundled to `dist/client/` with `bun build`. No framework — vanilla TypeScript with class-based UI components.

Key modules:
- `app.ts` — Entry point, state orchestration, session switching
- `canvas.ts` / `compositor.ts` / `layers.ts` — PixiJS rendering with multi-layer compositing
- `input.ts` — Pointer/touch input with pressure support
- `brushes/` — Six brush implementations sharing the `Brush` interface
- `canvas-lock.ts` — BroadcastChannel-based cross-tab session locking
- `persistence.ts` — Session-scoped IndexedDB canvas persistence
- `connection.ts` — WebSocket client with auto-reconnect

## Submission Flow

```
1. Draw on canvas          2. Click Submit           3. Server saves PNG
   [  /\   ]                  image: base64             /tmp/trayce/submissions/
   [ /  \  ]        --->      prompt: "make this" --->  sub-1774268000.png
   [/____\ ]                  target: session-A

4. Route to bridge         5. MCP notification        6. Claude reads image
   { pngPath, prompt }       notifications/             Read tool on
   via WebSocket     --->     claude/channel    --->     /tmp/trayce/submissions/
                              to Claude Code             sub-1774268000.png
```

The PNG is passed by **file path**, not inline. Claude uses its Read tool to view the image.

## Push Image Flow (Claude to Canvas)

Claude can send images back to the browser canvas via the `push_image` MCP tool:

```
Claude calls push_image  -->  Bridge reads file, base64-encodes  -->  Server forwards
to Bridge (MCP stdio)         sends via WebSocket to Server            to Browser (WS)
                                                                       --> renders as
                                                                          new layer
```

## WebSocket Protocol

### Server <-> Browser (`/canvas`)

| Direction | Type | Payload |
|-----------|------|---------|
| S -> B | `server-info` | `{ containerMode }` |
| S -> B | `sessions` | `{ sessions: [{ id, label, status }] }` |
| B -> S | `submit` | `{ targetSessionId, image?, prompt }` |
| S -> B | `ack` | `{ submissionId, timestamp }` |
| S -> B | `error` | `{ code, message }` |
| S -> B | `response` | `{ content, timestamp }` |
| S -> B | `transcript-entry` | `{ entry }` |
| S -> B | `canvas-push` | `{ image, label }` |
| S -> B | `usage-snapshot` / `usage-update` | `{ usage }` |
| B -> S | `watch-session` | `{ sessionId }` |
| Both | `heartbeat` | `{}` |

### Server <-> Bridge (`/bridge`)

| Direction | Type | Payload |
|-----------|------|---------|
| B -> S | `register` | `{ sessionId, label }` |
| S -> B | `submission` | `{ id, pngPath, prompt }` |
| B -> S | `response` | `{ content, sessionId }` |
| B -> S | `transcript-entry` | `{ entry, sessionId }` |
| B -> S | `canvas-push` | `{ image, label, sessionId }` |
| B -> S | `usage-update` | `{ usage, sessionId }` |
| Both | `heartbeat` | `{}` |

Heartbeats are exchanged every 10 seconds. Connections that miss heartbeats for 30 seconds are closed.

All bridge-to-server messages are validated at the parse boundary using Zod discriminated unions (`shared/protocol-schema.ts`). Invalid payloads are logged and dropped.
