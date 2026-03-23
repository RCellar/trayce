#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${TRAYCE_STATE_FILE:-/tmp/trayce/state.json}"

# Check for existing instance
if [ -f "$STATE_FILE" ]; then
  PID=$(jq -r '.pid // empty' "$STATE_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    URL=$(jq -r '.url // empty' "$STATE_FILE" 2>/dev/null || echo "")
    echo "{\"status\":\"existing\",\"url\":\"$URL\",\"pid\":$PID}"
    exit 0
  fi
  rm -f "$STATE_FILE"
fi

# Build client if needed
if [ ! -f "dist/client/app.js" ]; then
  echo "[trayce] Building client..."
  bun run build:client
fi

# Start server
nohup bun run server/index.ts > /tmp/trayce/server.log 2>&1 &
SERVER_PID=$!
disown

# Wait for state file
for i in $(seq 1 100); do
  [ -f "$STATE_FILE" ] && break
  sleep 0.1
done

if [ -f "$STATE_FILE" ]; then
  URL=$(jq -r '.url // empty' "$STATE_FILE" 2>/dev/null || echo "")
  echo "{\"status\":\"new\",\"url\":\"$URL\",\"pid\":$SERVER_PID}"
else
  echo "{\"status\":\"error\",\"message\":\"Server failed to start\"}" >&2
  exit 1
fi
