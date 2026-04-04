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
