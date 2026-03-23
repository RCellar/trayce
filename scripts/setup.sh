#!/usr/bin/env bash
set -euo pipefail

# trayce setup — configures Claude Code to use trayce as a channel
#
# Usage:
#   bash scripts/setup.sh                    # Interactive setup
#   bash scripts/setup.sh --label my-project # Set session label
#   bash scripts/setup.sh --global           # Install to ~/.claude/.mcp.json
#   bash scripts/setup.sh --uninstall        # Remove trayce from MCP config

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRAYCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BRIDGE_PATH="$TRAYCE_ROOT/bridge/index.ts"

LABEL=""
SCOPE="project"  # project or global
UNINSTALL=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --label) LABEL="$2"; shift 2 ;;
    --global) SCOPE="global"; shift ;;
    --uninstall) UNINSTALL=true; shift ;;
    -h|--help)
      echo "Usage: bash scripts/setup.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --label NAME    Session label shown in trayce dropdown (default: directory name)"
      echo "  --global        Install to ~/.claude/.mcp.json instead of project .mcp.json"
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
  MCP_FILE="$HOME/.claude/.mcp.json"
  mkdir -p "$(dirname "$MCP_FILE")"
else
  MCP_FILE=".mcp.json"
fi

# Uninstall
if [ "$UNINSTALL" = true ]; then
  if [ -f "$MCP_FILE" ]; then
    if command -v jq &>/dev/null; then
      jq 'del(.mcpServers.trayce)' "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
      echo "✓ Removed trayce from $MCP_FILE"
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
if ! command -v bun &>/dev/null; then
  echo "Error: bun is required but not found."
  echo "Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

if [ ! -f "$BRIDGE_PATH" ]; then
  echo "Error: Bridge not found at $BRIDGE_PATH"
  echo "Run this script from the trayce project root."
  exit 1
fi

# Install dependencies if needed
if [ ! -d "$TRAYCE_ROOT/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$TRAYCE_ROOT" && bun install)
fi

# Build client if needed
if [ ! -f "$TRAYCE_ROOT/dist/client/app.js" ]; then
  echo "Building client..."
  (cd "$TRAYCE_ROOT" && bun run build:client)
fi

# Default label
if [ -z "$LABEL" ]; then
  LABEL="$(basename "$(pwd)")"
fi

# Build the MCP config entry
# Global installs omit TRAYCE_LABEL so each session auto-labels from its cwd
if [ "$SCOPE" = "global" ]; then
  TRAYCE_ENTRY=$(cat <<JSONEOF
{
  "command": "bun",
  "args": ["run", "$BRIDGE_PATH"]
}
JSONEOF
)
else
  TRAYCE_ENTRY=$(cat <<JSONEOF
{
  "command": "bun",
  "args": ["run", "$BRIDGE_PATH"],
  "env": {
    "TRAYCE_LABEL": "$LABEL"
  }
}
JSONEOF
)
fi

# Write or merge into MCP config
if command -v jq &>/dev/null; then
  if [ -f "$MCP_FILE" ]; then
    # Merge into existing config
    jq --argjson entry "$TRAYCE_ENTRY" '.mcpServers.trayce = $entry' "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
  else
    # Create new config
    echo "{\"mcpServers\":{\"trayce\":$TRAYCE_ENTRY}}" | jq . > "$MCP_FILE"
  fi
else
  # No jq — write config directly (will overwrite existing)
  cat > "$MCP_FILE" <<MCPEOF
{
  "mcpServers": {
    "trayce": $TRAYCE_ENTRY
  }
}
MCPEOF
fi

echo ""
echo "✓ trayce configured in $MCP_FILE"
echo "  Label: $LABEL"
echo "  Bridge: $BRIDGE_PATH"
echo ""
echo "Next steps:"
echo ""
echo "  1. Start the trayce server (if not already running):"
echo "     cd $TRAYCE_ROOT && bash scripts/start.sh"
echo ""
echo "  2. Launch Claude Code with the channel flag:"
echo "     claude --dangerously-load-development-channels server:trayce"
echo ""
echo "  3. Open the trayce canvas in your browser (URL printed by start.sh)"
echo ""
echo "  4. Draw and submit — Claude will see your sketches!"
