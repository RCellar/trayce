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
bun run typecheck              # TypeScript type checking (tsc --noEmit)
bun run lint                   # Biome linter
bun run format                 # Biome formatter (auto-fix)
bun run check                  # Biome lint + format combined
bash scripts/start.sh          # Start server daemonized (reuses existing)
bash scripts/stop.sh           # Stop daemonized server
bash scripts/status.sh         # JSON status (running PID/URL or reason not running)
bash scripts/build-image.sh    # Build container image (uses podman on this system)
```

`build:client` bundles `client/app.ts` and copies `index.html` + `style.css` to `dist/client/`.

Setup for a project: `bash scripts/setup.sh --label my-project` then launch Claude with `claude --dangerously-load-development-channels server:trayce`.

## Code Style

- Biome for linting and formatting (not ESLint/Prettier)
- 2-space indent, double quotes, 100 char line width
- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled
- `noExplicitAny` is off — `any` is allowed where useful

## Plugin

`plugin/` contains a Claude Code plugin with skills (`trayce`, `trayce-setup`, `trayce-start`, `trayce-status`, `trayce-stop`) that teach Claude how to use, set up, start, check status of, and stop the canvas. The plugin is distributed alongside the project and configured via `scripts/setup.sh`.

## Architecture

Three independent processes cooperate via WebSocket:

1. **Server** (`server/`) — Bun HTTP + WebSocket server (long-lived, port 9740). Serves the client SPA, manages WebSocket connections from both browsers and bridges, stores submissions as PNG files on disk (`/tmp/trayce/submissions/`), and writes a state file (`/tmp/trayce/state.json`) with PID/port/token. `state.json` is the discovery mechanism — bridges and tooling read it to find the running server and auth token.

2. **Bridge** (`bridge/`) — MCP Channel bridge, spawned per Claude Code session. Reads `state.json` to discover the server, connects via WebSocket, registers its session, and forwards submissions as `notifications/claude/channel` to Claude. Also watches the Claude session's transcript file for live updates and relays usage/cost data. Exposes a `push_image` MCP tool that lets Claude send images (by file path or base64) back to the browser canvas as new layers.
   - `index.ts` — MCP server setup, `push_image` tool, WebSocket connection, message routing, permission request forwarding
   - `transcript-watcher.ts` — Watches Claude's JSONL transcript for tool calls, responses, and usage data; emits parsed entries to the server. Gotcha: must lock to the correct session file (see commit `9c74196`) — don't assume the newest transcript is the active one.

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

Message types: `register` (bridge→server), `submit` (browser→server), `submission` (server→bridge), `sessions` (server→browser), `ack`/`error` (server→browser), `heartbeat` (bidirectional), `permission-request`/`permission-verdict` (permission flow between Claude↔bridge↔server↔browser), `transcript-entry`/`response`/`usage-snapshot`/`usage-update` (live session data).

### Shared Module

`shared/protocol.ts` defines all TypeScript types for WebSocket messages, and `shared/protocol-schema.ts` provides corresponding Zod schemas for runtime validation. Both server and bridge import from here — keep them in sync.

### Key Server Modules

- `websocket.ts` — `WebSocketHub` handles all WS logic: routing, rate limiting (sliding window, 10/min), heartbeat timeouts (30s)
- `config.ts` — All config from env vars (`TRAYCE_HOST`, `TRAYCE_PORT`, `TRAYCE_NO_AUTH`, etc.) with defaults
- `submissions.ts` — Disk-backed PNG store with TTL cleanup (1h default)
- `sessions.ts` — In-memory session registry with auto-dedup labels

### Client Architecture

Vanilla TS with class-based UI components — no framework. Entry point is `app.ts`. Key patterns:
- `brushes/` — All brushes implement the `Brush` interface from `brushes/types.ts`
- `tools/` — Non-brush tools (select, lasso, shapes, arrow, text, image)
- Canvas rendering uses PixiJS with multi-layer compositing (`canvas.ts`, `compositor.ts`, `layers.ts`)
- Side panel tabs (`response-tab.ts`, `transcript-tab.ts`, `usage-tab.ts`) show live session data

## Testing

Tests use Bun's built-in test runner. Test files mirror source structure under `tests/`. Integration and e2e tests exist alongside unit tests:
- `tests/server/` — Unit tests for each server module + integration test
- `tests/bridge/` — Bridge unit tests
- `tests/client/` — Client module tests (layers, stroke, connection, history, persistence)
- `tests/e2e/` — End-to-end submission flow

## Specs

Design documents in `docs/superpowers/specs/`:
- `2026-03-23-trayce-design.md` — Original full design document
- `2026-03-27-bidirectional-and-panels-design.md` — Bidirectional communication and side panels
- `2026-03-27-ui-redesign.md` — UI overhaul
- `2026-03-27-image-import.md` — Image import tool
- `2026-03-27-image-layer-transforms.md` — Image layer transform controls
- `2026-03-27-trayce-skill.md` — Claude Code plugin/skill system
