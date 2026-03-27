# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Trayce

Canvas drawing tool that sends hand-drawn sketches to Claude Code sessions via MCP Channels. Users draw in a browser, pick a connected Claude session, and submit — Claude receives the sketch as a PNG + optional prompt text.

## Commands

```bash
bun install                    # Install dependencies
bun run build:client           # Bundle client (must run before start)
bun run start                  # Start server (prints URL with auth token)
bun run dev                    # Server with hot reload (--watch)
bun run dev:client             # Client bundler in watch mode
bun test                       # Run all tests
bun test tests/server/auth.test.ts  # Run a single test file
bash scripts/start.sh          # Start server daemonized (reuses existing)
bash scripts/stop.sh           # Stop daemonized server
```

`build:client` bundles `client/app.ts` and copies `index.html` + `style.css` to `dist/client/`.

Setup for a project: `bash scripts/setup.sh --label my-project` then launch Claude with `claude --dangerously-load-development-channels server:trayce`.

## Architecture

Three independent processes cooperate via WebSocket:

1. **Server** (`server/`) — Bun HTTP + WebSocket server (long-lived, port 9740). Serves the client SPA, manages WebSocket connections from both browsers and bridges, stores submissions as PNG files on disk (`/tmp/trayce/submissions/`), and writes a state file (`/tmp/trayce/state.json`) with PID/port/token.

2. **Bridge** (`bridge/index.ts`) — Single-file MCP Channel bridge (~100 lines). Spawned per Claude Code session as an MCP server. Reads `state.json` to discover the server, connects via WebSocket, registers its session, and forwards submissions as `notifications/claude/channel` to Claude.

3. **Client** (`client/`) — Browser painting app (PixiJS + perfect-freehand, vanilla TS). Bundled to `dist/client/` with `bun build`. No framework — DOM manipulation via class-based UI components.

### Data Flow

```
Browser canvas → submit (base64 PNG over WS) → Server saves to disk →
Server forwards path to Bridge → Bridge sends MCP channel notification →
Claude reads PNG file from disk path
```

The PNG is passed by file path, not inline — Claude uses its Read tool on the path.

### WebSocket Protocol

Two WebSocket endpoints, both token-authenticated:
- `/canvas` — browser connections (kind: "browser")
- `/bridge` — bridge connections (kind: "bridge")

Message types: `register` (bridge→server), `submit` (browser→server), `submission` (server→bridge), `sessions` (server→browser), `ack`/`error` (server→browser), `heartbeat` (bidirectional).

### Server Internals

- `config.ts` — All config from env vars (`TRAYCE_HOST`, `TRAYCE_PORT`, `TRAYCE_NO_AUTH`, etc.) with defaults
- `auth.ts` — Token generation/validation (crypto.randomBytes)
- `sessions.ts` — In-memory session registry with auto-dedup labels
- `submissions.ts` — Disk-backed PNG store with TTL cleanup (1h default)
- `websocket.ts` — `WebSocketHub` handles all WS logic: routing, rate limiting (sliding window, 10/min), heartbeat timeouts (30s)
- `http.ts` — Static file serving for the client SPA

### Client Internals

- `app.ts` — Entry point, wires everything together. No module bundler framework.
- `canvas.ts` / `compositor.ts` / `layers.ts` — PixiJS rendering with multi-layer compositing
- `input.ts` — Pointer/touch input with pressure support
- `brushes/` — Brush implementations (pen, pencil, marker, watercolor, highlighter, eraser) all implement the `Brush` interface from `brushes/types.ts`
- `tools/` — Non-brush tools (select, lasso, shapes, arrow, text, image)
- `connection.ts` — WebSocket client with auto-reconnect
- `export.ts` — Flattens layers to PNG blob for submission

## Testing

Tests use Bun's built-in test runner. Test files mirror source structure under `tests/`. Integration and e2e tests exist alongside unit tests:
- `tests/server/` — Unit tests for each server module + integration test
- `tests/bridge/` — Bridge unit tests
- `tests/client/` — Client module tests (layers, stroke, connection, history, persistence)
- `tests/e2e/` — End-to-end submission flow

## Spec

Full design document: `docs/superpowers/specs/2026-03-23-trayce-design.md`
