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
