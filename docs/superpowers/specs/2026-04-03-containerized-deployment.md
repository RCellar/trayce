# Containerized Deployment Design

## Summary

Formalize trayce's container deployment story. The server + client SPA run inside a container managed by compose, exposing a port to the host. Bridges continue running on the host as MCP subprocesses, connecting to the containerized server via env-var-driven configuration. Authentication is optional via a token passed as an environment variable.

## Architecture

```
Host                                    Container (trayce)
+-----------------------------------+   +------------------------+
|                                   |   |                        |
|  Claude Code                      |   |  Server (Bun)          |
|    └─ Bridge (MCP subprocess)     |   |    ├─ HTTP (SPA)       |
|         ├─ reads transcript       |   |    └─ WebSocket hub    |
|         └─ connects via WS ──────────>|       /canvas, /bridge |
|                                   |   |                        |
|  Browser ─────────────────────────────>|                        |
|                                   |   +------------------------+
|  /tmp/trayce/submissions/ <── bind mount ── /tmp/trayce/submissions/
+-----------------------------------+
```

Three-process model is unchanged. Only the server moves into the container.

## Server Auth Changes

Token resolution priority:

1. `TRAYCE_NO_AUTH=true` — auth disabled entirely
2. `TRAYCE_TOKEN` env var set and non-empty — use as auth token
3. Neither set — auto-generate a random token (bare-metal backward compat)

When `TRAYCE_TOKEN` is empty string or unset (and `TRAYCE_NO_AUTH` is not true), the server falls back to auto-generating a token. This preserves current bare-metal behavior where `scripts/start.sh` just works.

For container deployments, the simplified pattern is: no `TRAYCE_TOKEN` = no auth, set `TRAYCE_TOKEN` = auth enabled. Users who want no auth on bare metal still use `TRAYCE_NO_AUTH=true`.

### Changes

- `server/config.ts` — Add `token` field to `Config`, read from `TRAYCE_TOKEN` env var
- `server/index.ts` — Use `config.token` when set instead of calling `generateToken()`

State file write remains for bare-metal compatibility but is not used by container deployments.

## Compose File

`compose.yml` at project root:

```yaml
services:
  trayce:
    build: .
    container_name: trayce
    ports:
      - "${TRAYCE_PORT:-9740}:9740"
    volumes:
      - /tmp/trayce/submissions:/tmp/trayce/submissions
    environment:
      - TRAYCE_TOKEN=${TRAYCE_TOKEN:-}
      - TRAYCE_HOST=0.0.0.0
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "bun", "--eval", "fetch('http://localhost:9740').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 5s
```

- Port mapping uses `TRAYCE_PORT` from host env for remapping without editing the file. Container always listens on 9740 internally.
- Submissions bind mount at the same path on both sides so PNG paths Claude receives are valid on the host.
- Empty `TRAYCE_TOKEN` = no auth in container context. Non-empty = use as token.
- Health check hits the root URL (SPA) as a basic liveness probe.

## Container Management Scripts

### `scripts/container-start.sh`

- Auto-detects podman vs docker (same pattern as existing `build-image.sh`)
- Checks if container is already running via `$RUNTIME ps --filter name=trayce` — if so, prints existing URL and exits
- Runs `$RUNTIME compose up -d --build`
- Waits for health check to pass
- Prints the URL (with token query param if `TRAYCE_TOKEN` is set)

### `scripts/container-stop.sh`

- Auto-detects runtime
- Runs `$RUNTIME compose down`

Both scripts share the same runtime-detection pattern.

## Bridge Setup Script

### `scripts/setup-bridge.sh`

Replaces the bridge-configuration parts of `setup.sh` for container deployments. Configures `.mcp.json` with env vars pointing the bridge at the containerized server.

**Flags:**
- `--label NAME` — Session label (default: directory name)
- `--global` — Install to `~/.claude.json` instead of project `.mcp.json`
- `--uninstall` — Remove trayce from MCP config
- `--host HOST` — Server host (default: `localhost`)
- `--port PORT` — Server port (default: `9740`)
- `--token TOKEN` — Auth token (default: none)

**Output `.mcp.json` entry:**

```json
{
  "mcpServers": {
    "trayce": {
      "command": "/path/to/bun",
      "args": ["run", "/path/to/bridge/index.ts"],
      "env": {
        "TRAYCE_HOST": "localhost",
        "TRAYCE_PORT": "9740",
        "TRAYCE_TOKEN": "mysecret",
        "TRAYCE_LABEL": "my-project"
      }
    }
  }
}
```

Bridge code requires no changes — it already reads `TRAYCE_HOST`, `TRAYCE_PORT`, and `TRAYCE_TOKEN` from env vars with state file fallback.

Still requires bun on the host since the bridge is an MCP subprocess of Claude Code.

## Dockerfile Changes

- Remove hardcoded `ENV TRAYCE_HOST` and `ENV TRAYCE_PORT` — compose handles these
- Add `HEALTHCHECK` instruction as fallback for non-compose usage
- Ensure `/tmp/trayce/submissions` directory exists inside the image

Multi-stage build (deps, build client, slim runtime) stays the same.

## What Stays, What Changes, What's New

| Item | Status |
|---|---|
| `server/index.ts` | Modified — token from `TRAYCE_TOKEN` env, empty = no auth |
| `server/config.ts` | Modified — add `token` field, read from `TRAYCE_TOKEN` |
| `server/auth.ts` | Unchanged |
| `bridge/index.ts` | Unchanged — already reads env vars |
| `Dockerfile` | Modified — remove hardcoded env vars, add healthcheck |
| `compose.yml` | New |
| `scripts/container-start.sh` | New |
| `scripts/container-stop.sh` | New |
| `scripts/setup-bridge.sh` | New |
| `scripts/setup.sh` | Unchanged — bare-metal path preserved |
| `scripts/start.sh` | Unchanged — bare-metal path preserved |
| `scripts/stop.sh` | Unchanged — bare-metal path preserved |
| `scripts/build-image.sh` | Unchanged |
| `plugin/` | Unchanged |

## Testing

- Unit tests for new token-from-env logic in `server/config.ts` (TRAYCE_TOKEN priority, empty string handling)
- Unit test for `server/index.ts` token selection (env token vs auto-generate vs no-auth)
- No bridge or websocket test changes — behavior is unchanged
