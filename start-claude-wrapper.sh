#!/bin/bash
# Start Claude HTTP Wrapper Service
# This runs on the host and exposes Claude CLI as an HTTP API

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=${1:-8765}

echo "Starting Claude HTTP Wrapper on port $PORT..."
python3 "$SCRIPT_DIR/claude-http-wrapper.py" --port "$PORT"
