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

echo "Building trayce image with $RUNTIME..."
$RUNTIME build -t trayce:latest .
echo "Done. Image: trayce:latest"
