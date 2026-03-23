#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${TRAYCE_STATE_FILE:-/tmp/trayce/state.json}"

if [ ! -f "$STATE_FILE" ]; then
  echo "No running trayce server found."
  exit 0
fi

PID=$(jq -r '.pid // empty' "$STATE_FILE" 2>/dev/null || echo "")
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped trayce server (PID $PID)."
else
  echo "Server not running. Cleaning up state file."
  rm -f "$STATE_FILE"
fi
