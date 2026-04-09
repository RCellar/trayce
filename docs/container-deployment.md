# Container Deployment

The server + client SPA run inside a container managed by compose. Bridges remain on the host as MCP subprocesses. Auto-detects podman or docker.

## Starting

```bash
# Start (builds image, waits for health check)
bash scripts/container-start.sh

# Start with explicit token
TRAYCE_TOKEN=mysecret bash scripts/container-start.sh

# Stop
bash scripts/container-stop.sh
```

## How It Works

The container runs the Bun server and serves the client SPA. Bridges stay on the host because they're spawned by Claude Code as MCP subprocesses — they can't run inside the container.

Submissions are bind-mounted at `/tmp/trayce/submissions` on both host and container so PNG paths Claude receives are valid on the host filesystem.

## Connecting Bridges

Bridges need to know where the containerized server is. Use `setup-bridge.sh` instead of the regular `setup.sh`:

```bash
bash scripts/setup-bridge.sh --token mysecret

# Or with custom host/port:
bash scripts/setup-bridge.sh --host 10.0.0.5 --port 8080 --token mysecret
```

| Flag | Default | Description |
|------|---------|-------------|
| `--token TOKEN` | *(required)* | Auth token matching the container's `TRAYCE_TOKEN` |
| `--host HOST` | `127.0.0.1` | Server hostname/IP |
| `--port PORT` | `9740` | Server port |
| `--label NAME` | directory name | Session label |
| `--global` | | Install to `~/.claude.json` instead of project `.mcp.json` |
| `--uninstall` | | Remove trayce bridge from config |

Run `bash scripts/setup-bridge.sh --help` for all options.

## Building the Image

```bash
bash scripts/build-image.sh
```

Uses the runtime's native container tooling (podman on systems with podman, docker otherwise).

## Environment Variables

The container accepts the same environment variables as bare-metal:

| Variable | Container Default | Description |
|----------|-------------------|-------------|
| `TRAYCE_TOKEN` | *(none — no auth)* | Set explicitly for token auth |
| `TRAYCE_PORT` | `9740` | Server port (mapped in compose) |
| `TRAYCE_NO_AUTH` | `true` | Container default disables auth |

When running in a container, `TRAYCE_NO_AUTH` defaults to `true` since the token can't be auto-discovered via `state.json`. Set `TRAYCE_TOKEN` explicitly to enable auth.
