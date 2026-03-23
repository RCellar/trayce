# Trayce — Canvas Drawing Tool for Claude Code

**Date:** 2026-03-23
**Status:** Design approved, pending implementation

## Overview

Trayce is a network-accessible canvas drawing application that integrates with Claude Code via MCP Channels. Users draw on a full-featured raster painting canvas in their browser (from any local network device — PC, tablet, phone) and submit sketches as prompts or prompt supplements to Claude Code sessions. A dropdown selector lets users target any active Claude Code session, supporting multi-session workflows.

## Goals

- Provide a Procreate-lite drawing experience in the browser
- Integrate with Claude Code via the MCP Channel protocol (not hooks)
- Run independently of Claude Code — start once, use all day
- Support any device on the local network (tablets with stylus, PCs with mouse)
- Each device gets its own independent canvas
- Multi-session: submit drawings to any connected Claude Code session

## Non-Goals

- Real-time collaborative drawing (shared canvas between devices)
- Vector/SVG-based drawing (this is a raster painting tool)
- Running the bridge process inside the container (MCP requires host stdio)

## Constraints

- **Submission path contract:** The server always writes PNG files to `/tmp/trayce/submissions/` using absolute paths. When containerized, the volume mount must map this path identically on the host (`/tmp/trayce:/tmp/trayce`). The bridge resolves paths as-is — no path translation. This is an invariant of the architecture.
- **Memory budget:** The painting engine targets a working canvas of up to 4096×4096 pixels. At RGBA, one layer bitmap is ~64 MB. With 20 layers that's ~1.3 GB in the worst case. Undo history is capped by a configurable memory budget (default 256 MB) rather than a fixed step count.
- **Canvas resolution:** Users choose canvas dimensions when creating a new document (preset options: 1920×1080, 2560×1440, 4096×4096, or custom). The document resolution is independent of the display — zoom/pan navigates the canvas at any scale. Submissions export at the document resolution (no additional HiDPI multiplier — the document IS the full resolution).

---

## Architecture

### Three-Process Design

```
┌──────────────────────────────────────────────────────┐
│                 TRAYCE SERVER (Bun)                    │
│              Long-lived, binds 0.0.0.0                │
│                                                       │
│  HTTP Server ─── WebSocket Hub ─── Session Registry   │
│       │                │                 │            │
│       │         Connection Manager       │            │
│       │                │            Submit Store      │
└───────┼────────────────┼─────────────────┼────────────┘
        │                │                 │
   ┌────┴────┐    ┌──────┴──────┐   ┌─────┴───────┐
   │ Browser │    │   Bridge    │   │   Bridge    │
   │ Canvas  │    │  (MCP Ch.)  │   │  (MCP Ch.)  │
   │  (any   │    │  Claude     │   │  Claude     │
   │ device) │    │  Session A  │   │  Session B  │
   └─────────┘    └──────┬──────┘   └──────┬──────┘
                         │                 │
                  ┌──────┴──────┐   ┌──────┴──────┐
                  │ Claude Code │   │ Claude Code │
                  │ Session A   │   │ Session B   │
                  └─────────────┘   └─────────────┘
```

### Component Roles

**Trayce Server** — persistent Bun process. Serves the canvas UI as static files, manages WebSocket connections from browsers and bridge processes, stores submissions as PNG files in `/tmp/trayce/submissions/`, maintains an in-memory session registry of connected bridges.

**Bridge Process** — ~80-line Bun script spawned by Claude Code as an MCP Channel subprocess. Connects to the trayce server via WebSocket and registers its session with an ID and label. When the server routes a submission to this bridge, it pushes a `notifications/claude/channel` notification into Claude Code with the PNG file path and prompt text. Communicates with Claude Code over stdio (standard MCP transport).

**Browser Canvas** — vanilla HTML/JS app using PixiJS + perfect-freehand. Each browser instance has its own independent canvas, painting engine, layer stack, and undo history. Connects to trayce server via WebSocket. Sends submissions (flattened PNG + optional prompt text) targeted at a selected Claude session. Receives real-time session list updates for the dropdown selector.

### Submission Flow

1. User draws on canvas, selects target session from dropdown, clicks Submit
2. Browser flattens all layers → single PNG at document resolution + prompt text → WebSocket to trayce server
3. Trayce server writes PNG to `/tmp/trayce/submissions/sub-<timestamp>.png` → routes message to target bridge's WebSocket
4. Bridge pushes `notifications/claude/channel` with `{ content: promptText, meta: { image_path, submission_id } }`
5. Claude Code receives channel notification → reads PNG via Read tool → processes with prompt context

### What Claude Receives

```xml
<channel source="trayce" image_path="/tmp/trayce/submissions/sub-1774268000.png" submission_id="sub-1774268000">
  Please implement this UI layout I've sketched
</channel>
```

Claude then reads the image file, sees the sketch visually (multimodal), and responds based on the sketch + prompt text.

---

## Painting Engine

### Raster Model (Multi-Canvas Architecture)

Each layer is an `OffscreenCanvas` at document resolution. Freehand strokes render via perfect-freehand onto the active layer's canvas. PixiJS composites all layer canvases together with GPU blend modes for final display. Selection/transform operates on bitmap regions.

```
Pointer Events → pressure/tilt/position
     → Smoothing filter (configurable window)
     → perfect-freehand (stroke outline generation)
     → Brush Engine (texture, opacity, flow)
     → Paint onto active layer's OffscreenCanvas
     → PixiJS re-composites all layers → display
```

Steps 1–5 happen per `pointermove` event (~60–120Hz). Compositing happens on `requestAnimationFrame`.

### Layer System

- Each layer is an `OffscreenCanvas` at document resolution
- Properties per layer: name, visibility, opacity (0–100), blend mode, locked
- Operations: add, delete, duplicate, merge down, reorder (drag)
- Active layer receives all paint operations
- Background layer: non-deletable, white or transparent
- Max ~20 layers (memory-bound by canvas size × layer count)

### Blend Modes

Implemented via PixiJS sprite blend modes (GPU-native):

- Normal, Multiply, Screen, Overlay
- Soft Light, Hard Light
- Darken, Lighten
- Color Dodge, Color Burn

### Brush Engine

Six brush types, each implementing a common `Brush` interface:

| Brush | Behavior |
|-------|----------|
| **Pen** | Smooth, variable-width via perfect-freehand. Clean edges, consistent opacity. |
| **Pencil** | Grain texture overlay, slight jitter, lower opacity. Simulates graphite. |
| **Marker** | Flat tip, high opacity, slight transparency at edges. No pressure variation. |
| **Watercolor** | Renders stroke with Gaussian-blurred edges (radius proportional to brush size). Opacity accumulates additively within a single stroke using a separate stroke buffer composited on pointer-up. Wet-edge effect via alpha falloff gradient at stroke outline boundary. |
| **Highlighter** | Wide, semi-transparent, multiply blend for "over text" look. |
| **Eraser** | Paints with `destination-out` compositing on active layer. |

All brushes share configurable parameters:
- **Size:** 1–200px
- **Opacity:** 0–100%
- **Flow:** 0–100%
- **Smoothing:** 0–100%
- Pressure maps to size and/or opacity per brush configuration

### Selection & Transform

- **Rectangular select** — drag a box, copies bitmap region from active layer
- **Lasso select** — freehand outline, copies enclosed bitmap region
- **Transform** — move, scale, rotate the selected region (rendered as floating overlay)
- **Commit** — stamp transformed region back onto the layer
- Selected region is cut from layer (leaving transparent hole) while floating

### Undo / Redo

- **Hybrid approach:** command log with periodic bitmap checkpoints
- Each stroke is recorded as a command (brush type, points array, layer ID, brush params)
- Bitmap checkpoint saved every N strokes (default: every 10) as compressed PNG blob (via `OffscreenCanvas.convertToBlob()`)
- Undo replays from nearest checkpoint, skipping the undone command
- **Memory budget:** configurable cap (default 256 MB). When exceeded, oldest checkpoints are evicted. Undo depth degrades gracefully — you can always undo recent strokes, but very old history may be lost.
- Redo stack cleared on new stroke
- Layer operations (add/delete/reorder) are also undoable as commands
- This avoids the ~33 MB per raw `ImageData` snapshot problem while keeping undo responsive

### Additional Tools

- **Shapes** — rectangle, ellipse, line overlays rendered onto active layer on commit
- **Arrow** — line with arrowhead, rendered as raster on commit
- **Text** — click to place, inline editing, rendered onto layer on commit
- **Image import** — file picker, paste (Ctrl+V), drag-drop. Placed as floating selection for positioning, then stamped onto active layer.

### New Document Flow

On first load (or via menu), user sees a "New Canvas" dialog with preset options:
- 1920 × 1080 (HD)
- 2560 × 1440 (QHD)
- 4096 × 4096 (Square max)
- Custom width × height (max 4096 in either dimension)
- Background: white or transparent

The canvas resolution is fixed for the life of the document. Zoom/pan navigates within it.

### Color Picker

HSV color wheel with:
- Hue ring (outer) + saturation/value triangle (inner)
- RGB hex input field
- Opacity slider (for brush opacity, not color alpha)
- Recent colors strip (last 12 used colors, persisted in localStorage)
- Eyedropper tool: click anywhere on canvas to sample color

---

## UI Design

### Desktop Layout

```
┌─────────────────────────────────────────────────────────────┐
│ trayce    1920×1080 · 100%      Session: [Claude A ▾] [Submit]│
├────┬────────────────────────────────────────────┬───────────┤
│    │                                            │ BRUSH     │
│ T  │                                            │ Size  12px│
│ O  │                                            │ Opacity100│
│ O  │                                            │ Flow   80%│
│ L  │            CANVAS AREA                     │ Smooth 50%│
│    │                                            ├───────────┤
│ B  │         (white artboard on                 │ LAYERS    │
│ A  │          dark background)                  │ + ──────  │
│ R  │                                            │ ● Sketch  │
│    │                                            │   Annot.  │
│    │                                            │   Backgnd │
├────┴────────────────────────────────────────────┴───────────┤
│ ● Connected · 2 sessions  [prompt input............] Pen 12px│
└─────────────────────────────────────────────────────────────┘
```

- **Top bar:** logo, canvas dimensions, zoom, session selector dropdown, submit button
- **Left toolbar:** brush tools (pen, pencil, marker, watercolor, highlighter), eraser, selection tools (rect, lasso), shape tools (rect, ellipse, arrow), text, image import, color picker
- **Canvas area:** white artboard on dark background, zoom/pan controls bottom-right
- **Right panel (top):** brush settings — size, opacity, flow, smoothing sliders
- **Right panel (bottom):** layer list — visibility toggle, name, blend mode, reorder by drag
- **Bottom bar:** connection status, prompt text input, active tool + brush size, active layer name

### Tablet / Touch Adaptations

- Two-finger pinch → zoom
- Two-finger drag → pan
- Three-finger tap → undo
- Stylus draws, finger pans (palm rejection via Pointer Events API `pointerType` check)
- Tool bar collapses to bottom floating bar on narrow screens
- Layers panel becomes slide-out drawer
- Brush settings in popover instead of fixed panel
- Minimum 44px touch targets

### Keyboard Shortcuts (Desktop)

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| B | Pen | E | Eraser |
| N | Pencil | R | Rect select |
| M | Marker | L | Lasso select |
| W | Watercolor | U | Shapes |
| H | Highlighter | A | Arrow |
| T | Text | I | Import image |
| Shift+U | Cycle shape sub-tool | | |
| [ / ] | Brush size -/+ | Space+drag | Pan |
| Ctrl+Z | Undo | Ctrl+Y | Redo |
| Ctrl+Enter | Submit | | |

---

## MCP Channel Integration

### Bridge MCP Server

```typescript
// trayce-bridge.ts — spawned by Claude Code as MCP Channel
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "trayce",
  version: "1.0.0",
}, {
  capabilities: {
    experimental: { "claude/channel": {} },
  },
  instructions: `When you receive a trayce channel notification,
    read the PNG image at the provided path using the Read tool.
    The image is a hand-drawn sketch from the user. Treat the
    accompanying prompt text as the user's request about or
    relating to the sketch.`,
});

// Connect to trayce server via WebSocket
const ws = new WebSocket(`ws://${TRAYCE_HOST}:${TRAYCE_PORT}/bridge`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "register",
    sessionId: crypto.randomUUID(),
    label: process.env.TRAYCE_LABEL || basename(process.cwd()),
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "submission") {
    server.notification({
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
};

await server.connect(new StdioServerTransport());
```

### MCP Configuration

```json
// .mcp.json (in project root or ~/.claude/)
{
  "mcpServers": {
    "trayce": {
      "command": "bun",
      "args": ["run", "/path/to/trayce/bridge/index.ts"],
      "env": {
        "TRAYCE_HOST": "localhost",
        "TRAYCE_PORT": "9740",
        "TRAYCE_LABEL": "my-project"
      }
    }
  }
}
```

During the research preview, launch Claude Code with:
```bash
claude --dangerously-load-development-channels server:trayce
```

### Session Discovery

1. User starts Claude Code with trayce in `.mcp.json`
2. Claude Code spawns `bridge/index.ts` as MCP subprocess
3. Bridge connects to trayce server's `/bridge` WebSocket endpoint
4. Bridge sends `register` message with session ID + label
5. Trayce server adds session to registry, pushes updated list to all browsers
6. Browser dropdown updates immediately

Deregistration is automatic: when Claude Code exits, it kills the bridge subprocess, the WebSocket closes, the server removes the session from the registry and notifies browsers.

### Session Labels

- Default: working directory basename (e.g., "trayce", "my-app")
- Override via `TRAYCE_LABEL` env var
- Duplicate labels get numeric suffix: "my-app (2)"
- Tooltip shows full path + session ID on hover

---

## WebSocket Protocol

### Server ↔ Bridge

| Direction | Message | Payload |
|-----------|---------|---------|
| Bridge → Server | `register` | `{ sessionId, label }` |
| Bridge → Server | `heartbeat` | `{}` |
| Server → Bridge | `submission` | `{ id, pngPath, prompt }` |
| Server → Bridge | `heartbeat` | `{}` |

### Server ↔ Browser

| Direction | Message | Payload |
|-----------|---------|---------|
| Browser → Server | `submit` | `{ targetSessionId, image (base64), prompt }` |
| Browser → Server | `heartbeat` | `{}` |
| Server → Browser | `sessions` | `{ sessions: [{ id, label, status }] }` |
| Server → Browser | `ack` | `{ submissionId, timestamp }` |
| Server → Browser | `heartbeat` | `{}` |
| Server → Browser | `error` | `{ code, message }` |

### Connection Resilience

**Browser → Server:**
- Auto-reconnect with exponential backoff: 1s, 2s, 4s, ..., max 30s
- Heartbeat every 10s; if no heartbeat received for 25s, close and reconnect
- Connection status shown in bottom bar (green dot = connected, red dot = disconnected, yellow dot = reconnecting)
- Submit button disabled while disconnected; queued submissions are NOT retried (user must resubmit)
- On reconnect, browser re-requests session list

**Bridge → Server:**
- Auto-reconnect with exponential backoff: 1s, 2s, 4s, ..., max 30s
- If server is not running when bridge starts, retry connection indefinitely (bridge may start before server)
- Heartbeat every 10s; timeout at 25s triggers reconnect
- On reconnect, bridge re-sends `register` message
- In-flight submissions (sent to bridge but not yet pushed to Claude) are lost on disconnect — this is acceptable since the server still has the PNG on disk and can reroute if needed

**Server:**
- Heartbeat timeout: 30s without response → close connection, remove from registry
- Bridge disconnect → remove session from registry, notify browsers
- Browser disconnect → remove from connection pool (no other side effects)

---

## Network Security

### Access Control

- **Token-based auth** — server generates a random token on startup, printed to console and stored in `/tmp/trayce/state.json`
- **Token discovery for browsers:** the server prints a full URL with token embedded on startup: `http://host:port?token=xxx`. User copies this URL to any device. The token is stored in the browser's localStorage on first use, so subsequent visits don't need it in the URL.
- **Token discovery for bridges:** the bridge reads `/tmp/trayce/state.json` at startup to get the token (and host/port). This works because the bridge runs on the host where the state file is accessible. The `TRAYCE_TOKEN` env var is an optional override (e.g., when the server is containerized and state.json is behind a volume mount — the token is also printed to container logs).
- **MCP config does NOT need the token** — the bridge discovers it from state.json automatically. The `.mcp.json` only needs `TRAYCE_HOST` and `TRAYCE_PORT` (and optionally `TRAYCE_LABEL`).
- WebSocket upgrade rejected without valid token
- Optional `--no-auth` flag for trusted networks

### Transport Hardening

- CSP headers — no inline scripts, no external resources (all JS served as external files)
- CORS restricted to same origin
- Path traversal protection on static file serving
- Submission payload max: 20 MB (a 4096×4096 PNG can reach 10-15 MB for detailed paintings; base64 adds ~33%)
- WebSocket max payload: 30 MB
- Rate limiting on submissions: 10 per minute per client, burst of 3
- If a submission exceeds the size limit, the server rejects it and sends an `error` message to the browser. The browser displays a toast: "Submission too large — try reducing canvas size or merging layers."

### Submission Cleanup

Submissions in `/tmp/trayce/submissions/` have a TTL of 1 hour. The server runs a cleanup sweep every 15 minutes, deleting files older than the TTL. On shutdown, the entire submissions directory is removed.

---

## Docker / Container Deployment

### Strategy

Only the trayce server goes in the container. The bridge must run on the host because Claude Code spawns it as a subprocess (MCP stdio transport) and it needs host filesystem access to write submission PNGs that Claude can read.

### Dockerfile (Multi-Stage)

```dockerfile
FROM oven/bun:slim AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build:client

FROM oven/bun:slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./dist/client
COPY server/ ./server/
COPY package.json .

ENV TRAYCE_HOST=0.0.0.0
ENV TRAYCE_PORT=9740
EXPOSE 9740

USER bun
CMD ["bun", "run", "server/index.ts"]
```

### Docker Compose

```yaml
services:
  trayce:
    build: .
    ports:
      - "9740:9740"
    volumes:
      - /tmp/trayce:/tmp/trayce
    environment:
      - TRAYCE_HOST=0.0.0.0
      - TRAYCE_PORT=9740
    restart: unless-stopped
```

### Podman Compatibility

`scripts/build-image.sh` detects the container runtime (podman or docker) and uses it accordingly. The Dockerfile is standard OCI — works with both. The compose file works with `podman-compose` or `docker compose`.

---

## Project Structure

```
trayce/
├── Dockerfile
├── compose.yaml
├── .dockerignore
├── package.json
├── tsconfig.json
├── bunfig.toml
├── CLAUDE.md
│
├── server/                     # Trayce server (long-lived Bun process)
│   ├── index.ts                # Entry point — HTTP + WebSocket server
│   ├── http.ts                 # Static file serving + REST API routes
│   ├── websocket.ts            # WebSocket hub — browser + bridge connections
│   ├── sessions.ts             # Session registry — track connected bridges
│   ├── submissions.ts          # Write/read submission PNGs to /tmp/trayce/
│   ├── auth.ts                 # Token generation + validation
│   └── config.ts               # Port, host, paths, limits
│
├── bridge/                     # MCP Channel bridge (spawned by Claude Code)
│   └── index.ts                # MCP server + WebSocket client (~80 lines)
│
├── client/                     # Browser app (served as static files)
│   ├── index.html              # Shell HTML — canvas container, panels
│   ├── style.css               # Styles — dark theme, responsive layout
│   ├── app.ts                  # App init — wire up all modules
│   ├── canvas.ts               # PixiJS setup, display compositor, zoom/pan
│   ├── layers.ts               # Layer manager — OffscreenCanvas per layer
│   ├── compositor.ts           # Composite layers → PixiJS with blend modes
│   ├── brushes/                # Brush engine
│   │   ├── types.ts            # Brush interface
│   │   ├── pen.ts              # Pen — perfect-freehand, clean strokes
│   │   ├── pencil.ts           # Pencil — grain texture, jitter
│   │   ├── marker.ts           # Marker — flat tip, high opacity
│   │   ├── watercolor.ts       # Watercolor — soft edges, opacity buildup
│   │   ├── highlighter.ts      # Highlighter — wide, semi-transparent
│   │   └── eraser.ts           # Eraser — destination-out compositing
│   ├── tools/                  # Non-brush tools
│   │   ├── select.ts           # Rectangular selection + transform
│   │   ├── lasso.ts            # Freehand lasso selection + transform
│   │   ├── shapes.ts           # Rectangle, ellipse, line overlays
│   │   ├── arrow.ts            # Arrow tool
│   │   ├── text.ts             # Text placement + inline editing
│   │   └── image.ts            # Import image (file, paste, drag-drop)
│   ├── input.ts                # Pointer events, pressure, smoothing
│   ├── stroke.ts               # perfect-freehand integration
│   ├── history.ts              # Undo/redo — per-layer bitmap snapshots
│   ├── touch.ts                # Touch gestures — pinch zoom, pan, palm rejection
│   ├── shortcuts.ts            # Keyboard shortcut handler
│   ├── connection.ts           # WebSocket client — submit, session updates
│   ├── sessions-ui.ts          # Session dropdown UI
│   ├── toolbar.ts              # Tool palette — desktop + mobile layouts
│   ├── layers-ui.ts            # Layers panel UI
│   ├── brush-settings-ui.ts    # Brush settings panel — sliders, preview
│   ├── color-picker.ts         # Color picker widget
│   └── export.ts               # Flatten layers → PNG for submission/download
│
├── dist/                       # Build output (gitignored)
│   └── client/                 # Bundled client JS + copied HTML/CSS
│
├── scripts/
│   ├── start.sh                # Start trayce server
│   ├── stop.sh                 # Stop trayce server
│   └── build-image.sh          # Build Docker/Podman image
│
└── .mcp.json.example           # Example MCP config for Claude Code
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `pixi.js` | WebGL/WebGPU renderer, layer compositing, blend modes |
| `perfect-freehand` | Pressure-sensitive stroke outline generation |
| `@modelcontextprotocol/sdk` | MCP server for bridge (Channel protocol) |

Three runtime dependencies. Bun provides HTTP server, WebSocket, and file I/O natively.

### Client Build Process

Client TypeScript files are bundled via `bun build` into a single JS output (`dist/client/app.js`). PixiJS and perfect-freehand are installed via `npm`/`bun add` and imported normally in TypeScript — Bun's bundler resolves and tree-shakes them into the output bundle. There is no separate `vendor/` directory; dependencies come from `node_modules` and are bundled at build time.

```bash
bun build client/app.ts --outdir dist/client --minify --target browser
```

The server serves `dist/client/` as static files. In development, `bun build --watch` provides rebuild-on-save. The HTML file references `app.js` as an external `<script>` tag (no inline scripts, compatible with CSP).

## State & Persistence

### Client (Browser)

- Canvas state lives in memory (OffscreenCanvas bitmaps)
- **Auto-save via IndexedDB** (not localStorage — localStorage has a 5-10 MB quota, far too small for raster layer data). Each layer is saved as a compressed PNG blob via `OffscreenCanvas.convertToBlob()`. Auto-save triggers every 60 seconds and on tab blur/close (`visibilitychange` event). On load, layers are restored from IndexedDB if present.
- Selected session, tool preferences, and recent colors persisted in localStorage (these are small key-value pairs, well within quota)
- **Tab isolation:** Each browser tab generates a unique `tabId` (stored in `sessionStorage`). IndexedDB keys are scoped by `tabId`, so multiple tabs on the same device have independent canvases without collision.

### Server

- Session registry: in-memory only (bridges re-register on restart)
- Submissions: written to `/tmp/trayce/submissions/`
- Server state: PID + port + token in `/tmp/trayce/state.json`
- Cleanup on shutdown: remove state file + submissions directory

## Tech Stack

- **Runtime:** Bun
- **Server:** Bun native HTTP + WebSocket
- **Client:** Vanilla HTML/CSS/TypeScript (no framework)
- **Rendering:** PixiJS v8 (WebGL/WebGPU)
- **Strokes:** perfect-freehand
- **MCP:** @modelcontextprotocol/sdk
- **Container:** Docker/Podman (OCI image)

## WebGL Fallback

If WebGL is unavailable (rare on modern devices, but possible on some older tablets), PixiJS v8 falls back to Canvas 2D rendering automatically. Blend modes will use Canvas 2D `globalCompositeOperation` equivalents (all listed blend modes have Canvas 2D counterparts). Performance will be reduced but functional.
