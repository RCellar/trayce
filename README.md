# Trayce

A canvas drawing tool that sends hand-drawn sketches directly to [Claude Code](https://claude.ai/code) sessions. Draw in your browser from any device on the local network, pick a Claude session, and submit — Claude sees your sketch as a PNG image alongside your prompt.

```
 You (browser)                    Claude Code
 +--------------+                +--------------+
 |              |   "Implement   |              |
 |  [sketch of  |   this layout" |  > I see a   |
 |   a UI with  | ------------> |    sketch of  |
 |   sidebar]   |   WebSocket    |    a sidebar  |
 |              |   + MCP        |    layout...  |
 +--------------+                +--------------+
```

## How It Works

Trayce runs as three cooperating processes:

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

### Submission Flow

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

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Claude Code](https://claude.ai/code) CLI

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> trayce
cd trayce
bun install

# 2. Build the client
bun run build:client

# 3. Start the server
bun run start
# Prints: [trayce] Open: http://localhost:9740?token=abc123...
```

Open the printed URL in any browser. The token authenticates your connection.

## Connecting to Claude Code

### Automated (recommended)

From any project directory where you want to use trayce:

```bash
bash /path/to/trayce/scripts/setup.sh --label my-project
```

This writes the MCP config into your project's `.mcp.json`. Then start Claude:

```bash
claude --dangerously-load-development-channels server:trayce
```

Options:

| Flag | Effect |
|------|--------|
| `--label NAME` | Session label shown in the trayce dropdown (default: directory name) |
| `--global` | Install to `~/.claude.json` instead of project `.mcp.json` |
| `--uninstall` | Remove trayce from MCP config |

### Manual

Add to `.mcp.json` in your project root (or `~/.claude.json` for global):

```json
{
  "mcpServers": {
    "trayce": {
      "command": "bun",
      "args": ["run", "/path/to/trayce/bridge/index.ts"],
      "env": {
        "TRAYCE_LABEL": "my-project"
      }
    }
  }
}
```

Then launch: `claude --dangerously-load-development-channels server:trayce`

## Usage

1. **Start the server** — `bun run start` or `bash scripts/start.sh` (daemonized)
2. **Open the URL** in a browser on any device on your network
3. **Start Claude** with the channel flag in a project that has trayce configured
4. **Draw** on the canvas using the brush tools
5. **Select a session** from the dropdown (shows all connected Claude instances)
6. **Type an optional prompt** in the bottom bar
7. **Click Submit** (or press `Ctrl+Enter`)

Claude receives the sketch and prompt, then responds based on what you drew.

### Multi-Session

Multiple Claude Code sessions can connect simultaneously. Each appears in the browser's session dropdown with its label. Draw once, submit to whichever session you choose.

### Multi-Device

The server binds `0.0.0.0`, so any device on the local network can open the URL. Each browser gets its own independent canvas. Use a tablet with a stylus for natural drawing, or a phone for quick sketches.

## Canvas Features

### Brushes

| Brush | Key | Description |
|-------|-----|-------------|
| Pen | `B` | Smooth, pressure-sensitive strokes via perfect-freehand |
| Pencil | `N` | Grain texture with slight jitter |
| Marker | `M` | Flat tip, high opacity, no pressure variation |
| Watercolor | `W` | Soft edges with opacity buildup |
| Highlighter | `H` | Wide, semi-transparent, multiply blend |
| Eraser | `E` | Removes content from active layer |

All brushes support **size** (1-200px), **opacity**, **flow**, and **smoothing** via the right panel sliders. Pressure-sensitive input is supported for stylus devices.

### Keyboard Shortcuts

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| `B` | Pen | `E` | Eraser |
| `N` | Pencil | `[` / `]` | Brush size -/+ |
| `M` | Marker | `Ctrl+Z` | Undo |
| `W` | Watercolor | `Ctrl+Y` | Redo |
| `H` | Highlighter | `Ctrl+Enter` | Submit |
| Scroll wheel | Zoom | | |

### Layers

The canvas supports multiple layers with independent visibility and blend modes. Use the layers panel on the right to add, delete, and reorder layers. The background layer is non-deletable.

### Canvas Resolution

Choose from presets (1920x1080, 2560x1440, 3840x2160, 4096x4096) via the resolution dropdown. The canvas exports at full document resolution regardless of zoom level.

## Server Management

### Bare Metal

```bash
# Start (daemonized, reuses existing instance if running)
bash scripts/start.sh

# Stop
bash scripts/stop.sh

# Start in foreground with hot reload (development)
bun run dev
```

The server writes its state to `/tmp/trayce/state.json` (PID, port, token). The bridge reads this file automatically to discover the server — no manual token configuration needed.

### Container Deployment

The server + client SPA run inside a container managed by compose. Bridges remain on the host as MCP subprocesses. Auto-detects podman or docker.

```bash
# Start (builds image, waits for health check)
bash scripts/container-start.sh

# Start with token auth
TRAYCE_TOKEN=mysecret bash scripts/container-start.sh

# Stop
bash scripts/container-stop.sh
```

Submissions are bind-mounted at `/tmp/trayce/submissions` on both host and container so PNG paths Claude receives are valid on the host.

To connect bridges to the containerized server:

```bash
bash scripts/setup-bridge.sh --token mysecret
# Or with custom host/port:
bash scripts/setup-bridge.sh --host 10.0.0.5 --port 8080 --token mysecret
```

See `bash scripts/setup-bridge.sh --help` for all options.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRAYCE_HOST` | `0.0.0.0` | Bind address |
| `TRAYCE_PORT` | `9740` | Server port |
| `TRAYCE_TOKEN` | *(none)* | Auth token (if unset, auto-generated for bare metal; no auth for container) |
| `TRAYCE_NO_AUTH` | `false` | Disable token authentication entirely |
| `TRAYCE_SUBMISSIONS_DIR` | `/tmp/trayce/submissions` | Where PNGs are stored |
| `TRAYCE_STATE_FILE` | `/tmp/trayce/state.json` | Server state file path |

Token priority: `TRAYCE_NO_AUTH=true` (no auth) > `TRAYCE_TOKEN` (explicit token) > auto-generate.

## Development

```bash
bun run dev            # Server with --watch (hot reload)
bun run dev:client     # Client bundler in watch mode
bun test               # Run all tests
bun test tests/server/auth.test.ts   # Run a single test file
```

### Project Structure

```
trayce/
  server/          Bun HTTP + WebSocket server
  bridge/          MCP Channel bridge (~100 lines, spawned per Claude session)
  client/          Browser painting app (PixiJS + perfect-freehand, vanilla TS)
    brushes/       Brush implementations (pen, pencil, marker, watercolor, highlighter, eraser)
    tools/         Non-brush tools (select, lasso, shapes, arrow, text, image)
  tests/           Bun test runner (mirrors source structure)
  scripts/         start.sh, stop.sh, setup.sh, container-start.sh, container-stop.sh, setup-bridge.sh
  dist/client/     Built client output (gitignored)
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `pixi.js` | WebGL/WebGPU rendering and layer compositing |
| `perfect-freehand` | Pressure-sensitive stroke outlines |
| `@modelcontextprotocol/sdk` | MCP Channel protocol for the bridge |

Three runtime dependencies. Bun provides HTTP, WebSocket, and file I/O natively.

## WebSocket Protocol

### Server <-> Browser

| Direction | Type | Payload |
|-----------|------|---------|
| Browser -> Server | `submit` | `{ targetSessionId, image (base64), prompt }` |
| Server -> Browser | `sessions` | `{ sessions: [{ id, label, status }] }` |
| Server -> Browser | `ack` | `{ submissionId, timestamp }` |
| Server -> Browser | `error` | `{ code, message }` |

### Server <-> Bridge

| Direction | Type | Payload |
|-----------|------|---------|
| Bridge -> Server | `register` | `{ sessionId, label }` |
| Server -> Bridge | `submission` | `{ id, pngPath, prompt }` |

Both directions also exchange `heartbeat` messages every 10 seconds. Connections that miss heartbeats for 30 seconds are closed.

## Security

- **Token auth** — random token generated on each server start (or set via `TRAYCE_TOKEN`), required for all WebSocket connections
- **Token discovery** — browsers get the token from the URL; bridges read it from `state.json` or `TRAYCE_TOKEN` env var
- **Rate limiting** — 10 submissions per minute per client
- **Size limits** — 20 MB max per submission, 30 MB max WebSocket payload
- **Submission cleanup** — PNGs are deleted after 1 hour; all submissions removed on shutdown
- **CSP headers** — no inline scripts, no external resources

Pass `TRAYCE_NO_AUTH=true` to disable token auth on trusted networks.

## License

MIT
