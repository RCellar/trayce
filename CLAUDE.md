# Trayce

Canvas drawing tool for Claude Code integration via MCP Channels.

## Quick Start

```bash
bun install                    # Install dependencies
bun run build:client           # Bundle client
bun run start                  # Start server (prints URL with auth token)
```

## Development

```bash
bun run dev                    # Server with hot reload
bun run dev:client             # Client bundler in watch mode
bun test                       # Run tests
```

## Architecture

- `server/` — Bun HTTP + WebSocket server (long-lived, binds 0.0.0.0)
- `bridge/` — MCP Channel bridge (spawned by Claude Code, ~80 lines)
- `client/` — Browser painting app (PixiJS + perfect-freehand, vanilla TS)
- `tests/` — Bun test runner

## Key Commands

```bash
bun run start                  # Start server
bash scripts/start.sh          # Start with session management
bash scripts/stop.sh           # Stop server
bash scripts/build-image.sh    # Build container image
```

## Spec

Full design: `docs/superpowers/specs/2026-03-23-trayce-design.md`
