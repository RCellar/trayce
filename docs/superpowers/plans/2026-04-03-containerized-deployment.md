# Containerized Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize trayce's container deployment with compose, env-var-driven auth, and clear bridge setup.

**Architecture:** Server + client SPA run in a container managed by compose. Bridges remain on the host as MCP subprocesses, connecting to the containerized server via `TRAYCE_HOST`/`TRAYCE_PORT`/`TRAYCE_TOKEN` env vars. Submissions bind-mounted so PNG paths are valid on both host and container.

**Tech Stack:** Bun, podman/docker compose, bash

**Spec:** `docs/superpowers/specs/2026-04-03-containerized-deployment.md`

---

### Task 1: Add `token` field to server config

**Files:**
- Modify: `server/config.ts:1-73`
- Modify: `tests/server/config.test.ts`

- [ ] **Step 1: Write failing tests for TRAYCE_TOKEN**

Add to `tests/server/config.test.ts`:

```typescript
describe("getConfig — TRAYCE_TOKEN", () => {
  test("token defaults to undefined", () => {
    expect(getConfig(env()).token).toBeUndefined();
  });

  test("TRAYCE_TOKEN sets token", () => {
    expect(getConfig(env({ TRAYCE_TOKEN: "mysecret" })).token).toBe("mysecret");
  });

  test("TRAYCE_TOKEN empty string results in undefined", () => {
    expect(getConfig(env({ TRAYCE_TOKEN: "" })).token).toBeUndefined();
  });

  test("TRAYCE_TOKEN whitespace-only results in undefined", () => {
    expect(getConfig(env({ TRAYCE_TOKEN: "   " })).token).toBeUndefined();
  });

  test("TRAYCE_TOKEN is trimmed", () => {
    expect(getConfig(env({ TRAYCE_TOKEN: "  abc123  " })).token).toBe("abc123");
  });
});
```

Also update the `"all Config keys are present"` test to include `"token"` in the keys array (add after `"noAuth"`). Since `token` is optional (`string | undefined`), change the assertion for it to use `expect(cfg).toHaveProperty("token")` — or just keep the existing `expect(cfg[key]).toBeDefined()` loop for all other keys and check `token` separately:

```typescript
test("all Config keys are present", () => {
  const cfg: Config = getConfig(env());
  const keys: (keyof Config)[] = [
    "host", "port", "submissionsDir", "stateFile", "clientDir",
    "maxSubmissionBytes", "maxWsPayloadBytes", "submissionTtlMs",
    "cleanupIntervalMs", "heartbeatIntervalMs", "heartbeatTimeoutMs",
    "rateLimitPerMinute", "noAuth", "transcriptBufferSize",
  ];
  for (const key of keys) {
    expect(cfg[key]).toBeDefined();
  }
  // token is optional — just verify the key exists
  expect("token" in cfg).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/config.test.ts`
Expected: FAIL — `token` property does not exist on Config

- [ ] **Step 3: Add `token` to Config interface and `getConfig`**

In `server/config.ts`, add `token` to the `Config` interface after `noAuth`:

```typescript
export interface Config {
  host: string;
  port: number;
  submissionsDir: string;
  stateFile: string;
  clientDir: string;
  maxSubmissionBytes: number;
  maxWsPayloadBytes: number;
  submissionTtlMs: number;
  cleanupIntervalMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  rateLimitPerMinute: number;
  transcriptBufferSize: number;
  noAuth: boolean;
  token?: string;
}
```

In `getConfig`, add after the `noAuth` line:

```typescript
token: env.TRAYCE_TOKEN?.trim() || undefined,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/config.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/config.ts tests/server/config.test.ts
git commit -m "feat(server): add TRAYCE_TOKEN to config"
```

---

### Task 2: Use config token in server startup

**Files:**
- Modify: `server/index.ts:1-113`

- [ ] **Step 1: Write failing test for token priority**

Create `tests/server/token-priority.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { getConfig } from "../../server/config";
import { generateToken } from "../../server/auth";

describe("token resolution priority", () => {
  test("noAuth=true means no token regardless of TRAYCE_TOKEN", () => {
    const config = getConfig({ TRAYCE_NO_AUTH: "true", TRAYCE_TOKEN: "mysecret" });
    expect(config.noAuth).toBe(true);
    // When noAuth is true, server should use empty token — verified via index.ts logic
  });

  test("TRAYCE_TOKEN set means use that token", () => {
    const config = getConfig({ TRAYCE_TOKEN: "mysecret" });
    expect(config.noAuth).toBe(false);
    expect(config.token).toBe("mysecret");
  });

  test("no TRAYCE_TOKEN and no noAuth means auto-generate", () => {
    const config = getConfig({});
    expect(config.noAuth).toBe(false);
    expect(config.token).toBeUndefined();
    // Server should call generateToken() in this case
    const generated = generateToken();
    expect(typeof generated).toBe("string");
    expect(generated.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/server/token-priority.test.ts`
Expected: PASS (this tests config behavior which already works from Task 1)

- [ ] **Step 3: Update `server/index.ts` to use config token**

Change line 11 of `server/index.ts` from:

```typescript
const token = config.noAuth ? "" : generateToken();
```

to:

```typescript
const token = config.noAuth ? "" : (config.token ?? generateToken());
```

This implements the priority: noAuth > explicit token > auto-generate.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.ts tests/server/token-priority.test.ts
git commit -m "feat(server): use TRAYCE_TOKEN env var when set"
```

---

### Task 3: Update Dockerfile

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Update the Dockerfile**

Replace the current Dockerfile content with:

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

RUN mkdir -p /tmp/trayce/submissions

EXPOSE 9740

HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=5s \
  CMD bun --eval "fetch('http://localhost:9740').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER bun
CMD ["bun", "run", "server/index.ts"]
```

Changes from current:
- Removed `ENV TRAYCE_HOST=0.0.0.0` and `ENV TRAYCE_PORT=9740` (compose provides these)
- Added `RUN mkdir -p /tmp/trayce/submissions` for bind mount target
- Added `HEALTHCHECK` for non-compose usage

- [ ] **Step 2: Verify image builds**

Run: `bash scripts/build-image.sh`
Expected: Build succeeds, prints "Done. Image: trayce:latest"

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat(docker): add healthcheck, remove hardcoded env vars"
```

---

### Task 4: Create compose.yml

**Files:**
- Create: `compose.yml`

- [ ] **Step 1: Create the compose file**

Create `compose.yml` at project root:

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

- [ ] **Step 2: Verify compose config is valid**

Run: `podman compose config 2>&1 || docker compose config 2>&1`
Expected: Prints the resolved compose config without errors

- [ ] **Step 3: Commit**

```bash
git add compose.yml
git commit -m "feat: add compose.yml for container deployment"
```

---

### Task 5: Create `scripts/container-start.sh`

**Files:**
- Create: `scripts/container-start.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Detect container runtime
if command -v podman &>/dev/null; then
  RUNTIME=podman
elif command -v docker &>/dev/null; then
  RUNTIME=docker
else
  echo "Error: Neither podman nor docker found." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER_NAME="trayce"

# Check if container is already running
if $RUNTIME ps --filter "name=^${CONTAINER_NAME}$" --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
  PORT=$($RUNTIME port "$CONTAINER_NAME" 9740 2>/dev/null | head -1 | cut -d: -f2)
  PORT="${PORT:-9740}"
  URL="http://localhost:${PORT}"
  if [ -n "${TRAYCE_TOKEN:-}" ]; then
    URL="${URL}?token=${TRAYCE_TOKEN}"
  fi
  echo "{\"status\":\"existing\",\"url\":\"$URL\",\"container\":\"$CONTAINER_NAME\"}"
  exit 0
fi

# Start with compose
echo "[trayce] Starting container with $RUNTIME compose..." >&2
cd "$PROJECT_DIR"
$RUNTIME compose up -d --build 2>&1 >&2

# Wait for health check
echo "[trayce] Waiting for health check..." >&2
for i in $(seq 1 30); do
  STATUS=$($RUNTIME inspect --format '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    break
  fi
  sleep 1
done

STATUS=$($RUNTIME inspect --format '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")
if [ "$STATUS" != "healthy" ]; then
  echo "{\"status\":\"error\",\"message\":\"Container not healthy after 30s (status: $STATUS)\"}" >&2
  exit 1
fi

PORT=$($RUNTIME port "$CONTAINER_NAME" 9740 2>/dev/null | head -1 | cut -d: -f2)
PORT="${PORT:-9740}"
URL="http://localhost:${PORT}"
if [ -n "${TRAYCE_TOKEN:-}" ]; then
  URL="${URL}?token=${TRAYCE_TOKEN}"
fi

echo "{\"status\":\"new\",\"url\":\"$URL\",\"container\":\"$CONTAINER_NAME\"}"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/container-start.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/container-start.sh
git commit -m "feat: add container-start.sh for compose-based startup"
```

---

### Task 6: Create `scripts/container-stop.sh`

**Files:**
- Create: `scripts/container-stop.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Detect container runtime
if command -v podman &>/dev/null; then
  RUNTIME=podman
elif command -v docker &>/dev/null; then
  RUNTIME=docker
else
  echo "Error: Neither podman nor docker found." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER_NAME="trayce"

# Check if running
if ! $RUNTIME ps --filter "name=^${CONTAINER_NAME}$" --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
  echo "No running trayce container found."
  exit 0
fi

cd "$PROJECT_DIR"
$RUNTIME compose down
echo "Stopped trayce container."
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/container-stop.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/container-stop.sh
git commit -m "feat: add container-stop.sh for compose-based shutdown"
```

---

### Task 7: Create `scripts/setup-bridge.sh`

**Files:**
- Create: `scripts/setup-bridge.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# trayce bridge setup — configures Claude Code to connect to a trayce server
#
# Usage:
#   bash scripts/setup-bridge.sh                          # Defaults: localhost:9740, no auth
#   bash scripts/setup-bridge.sh --token mysecret         # With auth token
#   bash scripts/setup-bridge.sh --host 10.0.0.5 --port 8080
#   bash scripts/setup-bridge.sh --global                 # Install to ~/.claude.json
#   bash scripts/setup-bridge.sh --uninstall              # Remove trayce from MCP config

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRAYCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BRIDGE_PATH="$TRAYCE_ROOT/bridge/index.ts"

LABEL=""
SCOPE="project"
UNINSTALL=false
HOST="localhost"
PORT="9740"
TOKEN=""

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --label) LABEL="$2"; shift 2 ;;
    --global) SCOPE="global"; shift ;;
    --uninstall) UNINSTALL=true; shift ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: bash scripts/setup-bridge.sh [OPTIONS]"
      echo ""
      echo "Configure Claude Code to connect to a trayce server."
      echo ""
      echo "Options:"
      echo "  --host HOST     Server host (default: localhost)"
      echo "  --port PORT     Server port (default: 9740)"
      echo "  --token TOKEN   Auth token (default: none — no auth)"
      echo "  --label NAME    Session label in trayce dropdown (default: directory name)"
      echo "  --global        Install to ~/.claude.json instead of project .mcp.json"
      echo "  --uninstall     Remove trayce from MCP config"
      echo "  -h, --help      Show this help"
      echo ""
      echo "After setup, launch Claude Code with:"
      echo "  claude --dangerously-load-development-channels server:trayce"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Determine config file path
if [ "$SCOPE" = "global" ]; then
  MCP_FILE="$HOME/.claude.json"
else
  MCP_FILE=".mcp.json"
fi

# Uninstall
if [ "$UNINSTALL" = true ]; then
  if [ -f "$MCP_FILE" ]; then
    if command -v jq &>/dev/null; then
      jq 'del(.mcpServers.trayce)' "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
      echo "Removed trayce from $MCP_FILE"
    else
      echo "jq is required for uninstall. Remove the 'trayce' entry from $MCP_FILE manually."
      exit 1
    fi
  else
    echo "No MCP config found at $MCP_FILE"
  fi
  exit 0
fi

# Check prerequisites
BUN_BIN="$(command -v bun 2>/dev/null || echo "")"
if [ -z "$BUN_BIN" ]; then
  echo "Error: bun is required but not found."
  echo "Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

if [ ! -f "$BRIDGE_PATH" ]; then
  echo "Error: Bridge not found at $BRIDGE_PATH"
  echo "Run this script from the trayce project root."
  exit 1
fi

# Install dependencies if needed (bridge needs MCP SDK)
if [ ! -d "$TRAYCE_ROOT/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$TRAYCE_ROOT" && bun install)
fi

# Default label
if [ -z "$LABEL" ]; then
  LABEL="$(basename "$(pwd)")"
fi

# Build env object for jq
ENV_JSON=$(jq -n \
  --arg host "$HOST" \
  --arg port "$PORT" \
  --arg token "$TOKEN" \
  --arg label "$LABEL" \
  '{TRAYCE_HOST: $host, TRAYCE_PORT: $port} +
   (if $token != "" then {TRAYCE_TOKEN: $token} else {} end) +
   (if $label != "" then {TRAYCE_LABEL: $label} else {} end)')

# Build MCP entry
TRAYCE_ENTRY=$(jq -n \
  --arg cmd "$BUN_BIN" \
  --arg bridge "$BRIDGE_PATH" \
  --argjson env "$ENV_JSON" \
  '{command: $cmd, args: ["run", $bridge], env: $env}')

# Write or merge into MCP config
if command -v jq &>/dev/null; then
  if [ -f "$MCP_FILE" ]; then
    jq --argjson entry "$TRAYCE_ENTRY" '.mcpServers.trayce = $entry' "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
  else
    echo "{\"mcpServers\":{\"trayce\":$TRAYCE_ENTRY}}" | jq . > "$MCP_FILE"
  fi
else
  echo "Error: jq is required for setup-bridge.sh."
  echo "Install jq and try again."
  exit 1
fi

echo ""
echo "trayce bridge configured in $MCP_FILE"
echo "  Server: $HOST:$PORT"
if [ -n "$TOKEN" ]; then
  echo "  Auth:   token-based"
else
  echo "  Auth:   none"
fi
if [ "$SCOPE" = "global" ]; then
  echo "  Label:  (dynamic — based on project directory)"
else
  echo "  Label:  $LABEL"
fi
echo ""
echo "Next: launch Claude Code with:"
echo "  claude --dangerously-load-development-channels server:trayce"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/setup-bridge.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-bridge.sh
git commit -m "feat: add setup-bridge.sh for container-aware bridge config"
```

---

### Task 8: Verify end-to-end container workflow

This is a manual smoke test, not automated.

- [ ] **Step 1: Stop any running bare-metal server**

Run: `bash scripts/stop.sh 2>/dev/null; true`

- [ ] **Step 2: Start the container without auth**

Run: `bash scripts/container-start.sh`
Expected: JSON output with `"status":"new"` and a URL

- [ ] **Step 3: Verify the server is accessible**

Run: `curl -s http://localhost:9740 | head -5`
Expected: HTML content from the SPA

- [ ] **Step 4: Verify submissions directory exists on host**

Run: `ls -la /tmp/trayce/submissions/`
Expected: Directory exists (may be empty)

- [ ] **Step 5: Stop the container**

Run: `bash scripts/container-stop.sh`
Expected: "Stopped trayce container."

- [ ] **Step 6: Start with a token**

Run: `TRAYCE_TOKEN=test123 bash scripts/container-start.sh`
Expected: JSON output with URL containing `?token=test123`

- [ ] **Step 7: Verify auth is enforced**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:9740/bridge`
Expected: `401`

Run: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:9740/bridge?token=test123"`
Expected: Non-401 (likely 400 or upgrade-required since it's a WS endpoint)

- [ ] **Step 8: Stop and clean up**

Run: `bash scripts/container-stop.sh`

- [ ] **Step 9: Commit any fixes from smoke testing**

If any issues were found and fixed during smoke testing, commit them.

```bash
git add -A
git commit -m "fix: address issues found during container smoke test"
```
