# Trayce

**A hand-drawn sketch pad for Claude Code sessions.**

[![CI](https://github.com/RCellar/trayce/actions/workflows/ci.yml/badge.svg)](https://github.com/RCellar/trayce/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1.svg)](https://bun.sh)

<!-- TODO: Replace with actual demo GIF -->
<!-- ![Trayce Demo](docs/assets/demo.gif) -->

Draw in your browser, pick a Claude Code session, submit — Claude sees your sketch as a PNG alongside your prompt. Use a tablet with a stylus for natural sketching, or a mouse for quick wireframes. Each session gets its own isolated canvas that persists across page reloads.

> **Use it when you want to...**
> - Sketch a UI layout and ask Claude to implement it
> - Annotate a screenshot with arrows and notes
> - Draw a diagram and ask Claude to build the architecture
> - Doodle a component design during a pair-programming session

## Quick Start

```bash
# Install and start
git clone https://github.com/RCellar/trayce.git
cd trayce && bun install
bun run build:client && bun run start
# Prints: [trayce] Open: http://localhost:9740?token=abc123...
```

Open the printed URL in your browser. Then connect a Claude Code session:

```bash
# From any project directory
bash /path/to/trayce/scripts/setup.sh --label my-project
claude --dangerously-load-development-channels server:trayce
```

Draw something, select the session from the dropdown, click **Submit** (or `Ctrl+Enter`).

## Features

### Brushes & Drawing

Six pressure-sensitive brushes — pen, pencil, marker, watercolor, highlighter, and eraser. All support size (1-200px), opacity, flow, and smoothing. Stylus pressure is detected automatically.

| Brush | Key | Brush | Key |
|-------|-----|-------|-----|
| Pen | `B` | Eraser | `E` |
| Pencil | `N` | Size -/+ | `[` / `]` |
| Marker | `M` | Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Watercolor | `W` | Submit | `Ctrl+Enter` |
| Highlighter | `H` | Zoom | Scroll wheel |

### Multi-Layer Canvas

Up to 20 layers with independent visibility, opacity, and blend modes (multiply, screen, overlay, etc.). Image import via paste, drag-and-drop, or file picker — imported images become transform layers you can move and resize.

### Session-Scoped Canvases

Each connected Claude session gets its own canvas, persisted to IndexedDB. Switching sessions saves and restores automatically. A scratchpad canvas is always available when no session is selected. Tab locking prevents two browser tabs from editing the same session's canvas.

### Bidirectional Communication

Claude can push images back to your canvas via the `push_image` MCP tool — useful for iterating on generated designs. The side panel shows Claude's responses, a live transcript of tool calls, and real-time token usage with cost estimates.

### Multi-Session Support

Multiple Claude Code sessions can connect simultaneously. Each appears in the session dropdown with its label. Draw once, submit to whichever session you choose.

## Setup

### Automated (recommended)

```bash
bash /path/to/trayce/scripts/setup.sh --label my-project
```

This writes the MCP config into your project's `.mcp.json`. Then start Claude with the channel flag:

```bash
claude --dangerously-load-development-channels server:trayce
```

| Flag | Effect |
|------|--------|
| `--label NAME` | Session label in the trayce dropdown (default: directory name) |
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

## Server Management

```bash
bun run start              # Start in foreground
bash scripts/start.sh      # Start daemonized (reuses existing instance)
bash scripts/stop.sh       # Stop daemonized server
bun run dev                # Development with hot reload
```

The server writes state to `/tmp/trayce/state.json` (PID, port, token). Bridges read this automatically — no manual token configuration needed.

### Canvas Resolution

Choose from presets (1920x1080, 2560x1440, 3840x2160, 4096x4096) via the resolution dropdown. Exports at full document resolution regardless of zoom level.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRAYCE_HOST` | `127.0.0.1` | Bind address |
| `TRAYCE_PORT` | `9740` | Server port |
| `TRAYCE_TOKEN` | *(auto-generated)* | Auth token (auto-generated if unset) |
| `TRAYCE_NO_AUTH` | `false` | Disable token authentication |
| `TRAYCE_SUBMISSIONS_DIR` | `/tmp/trayce/submissions` | PNG storage path |
| `TRAYCE_STATE_FILE` | `/tmp/trayce/state.json` | Server state file |

Token priority: `TRAYCE_NO_AUTH=true` > `TRAYCE_TOKEN` > auto-generate.

## Go Deeper

| Topic | Description |
|-------|-------------|
| [Architecture & Data Flow](docs/architecture.md) | Three-process model, submission flow, WebSocket protocol |
| [Container Deployment](docs/container-deployment.md) | Running trayce in a container with podman/docker compose |
| [Security](docs/security.md) | Token auth, rate limiting, CSP headers, size limits |

## Development

```bash
bun run dev            # Server with --watch
bun run dev:client     # Client bundler in watch mode
bun test               # Run all tests
```

### Project Structure

```
trayce/
  server/          Bun HTTP + WebSocket server
  bridge/          MCP Channel bridge (spawned per Claude session)
  client/          Browser canvas app (PixiJS + perfect-freehand, vanilla TS)
    brushes/       Brush implementations (pen, pencil, marker, watercolor, highlighter, eraser)
    tools/         Non-brush tools (image import)
  shared/          Protocol types and Zod schemas
  tests/           Bun test runner (mirrors source structure)
  scripts/         Server lifecycle, setup, container management
  plugin/          Claude Code plugin with trayce skills
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `pixi.js` | WebGL/WebGPU rendering and layer compositing |
| `perfect-freehand` | Pressure-sensitive stroke outlines |
| `@modelcontextprotocol/sdk` | MCP Channel protocol for the bridge |

Three runtime dependencies. Bun provides HTTP, WebSocket, and file I/O natively.

## License

MIT
