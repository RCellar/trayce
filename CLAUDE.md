# Trayce

Canvas drawing tool for Claude Code integration via MCP Channels.

## Quick Start

```bash
bun install                    # Install dependencies
bun run build:client           # Bundle client
bun run start                  # Start server (prints URL with auth token)
```

## Connecting to Claude Code

### Automated setup

From any project directory where you want to use trayce:

```bash
bash /path/to/trayce/scripts/setup.sh --label my-project
```

This writes the MCP config to your project's `.mcp.json`. Then launch Claude:

```bash
claude --dangerously-load-development-channels server:trayce
```

### Manual setup

Add to your project's `.mcp.json` (or `~/.claude/.mcp.json` for global):

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

Launch: `claude --dangerously-load-development-channels server:trayce`

### Using trayce

1. Open the URL printed by `bun run start` in any browser
2. The session dropdown shows connected Claude Code sessions
3. Draw on the canvas, type an optional prompt, click Submit
4. Claude sees your sketch as a PNG image + prompt text

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
bash scripts/setup.sh          # Configure Claude Code integration
bash scripts/build-image.sh    # Build container image
```

## Spec

Full design: `docs/superpowers/specs/2026-03-23-trayce-design.md`
