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
