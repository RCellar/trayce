#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${TRAYCE_STATE_FILE:-/tmp/trayce/state.json}"

if [ ! -f "$STATE_FILE" ]; then
  echo '{"running":false,"reason":"no state file"}'
  exit 0
fi

if ! command -v jq &>/dev/null; then
  echo '{"running":false,"reason":"jq not installed"}'
  exit 0
fi

PID=$(jq -r '.pid // empty' "$STATE_FILE" 2>/dev/null || echo "")
if [ -z "$PID" ]; then
  echo '{"running":false,"reason":"corrupt state file"}'
  exit 0
fi

if ! kill -0 "$PID" 2>/dev/null; then
  echo "{\"running\":false,\"reason\":\"stale state — pid $PID not alive\"}"
  exit 0
fi

URL=$(jq -r '.url // empty' "$STATE_FILE")
PORT=$(jq -r '.port // empty' "$STATE_FILE")
TOKEN=$(jq -r '.token // empty' "$STATE_FILE")
echo "{\"running\":true,\"pid\":$PID,\"port\":$PORT,\"url\":\"$URL\",\"token\":\"$TOKEN\"}"
