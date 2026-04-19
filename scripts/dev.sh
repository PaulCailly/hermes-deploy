#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Build server ──────────────────────────────────────────────
echo "Building server..."
cd "$ROOT" && npx tsup --silent 2>/dev/null

# ── Install web deps if needed ────────────────────────────────
if [ ! -d "$ROOT/web/node_modules" ]; then
  echo "Installing web dependencies..."
  cd "$ROOT/web" && npm install --silent
fi

# ── Temp file + cleanup trap (register early) ────────────────
BACKEND_LOG=$(mktemp)
BACKEND_PID=""
VITE_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  rm -f "$BACKEND_LOG"
}
trap cleanup EXIT INT TERM

# ── Start backend (Fastify on 4173) ──────────────────────────
echo "Starting backend..."
node "$ROOT/dist/cli.js" dashboard --port 4173 --no-open > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# Wait for the token line
TOKEN=""
for _ in $(seq 1 30); do
  if TOKEN_LINE=$(grep -o 'http://[^ ]*#token=[^ ]*' "$BACKEND_LOG" 2>/dev/null); then
    TOKEN=$(echo "$TOKEN_LINE" | grep -o 'token=.*' | cut -d= -f2)
    break
  fi
  sleep 0.2
done

if [ -z "$TOKEN" ]; then
  echo "Failed to start backend. Logs:"
  cat "$BACKEND_LOG"
  exit 1
fi

# ── Start frontend (Vite on 5173) ────────────────────────────
echo "Starting frontend..."
cd "$ROOT/web" && npx vite --clearScreen false > /dev/null 2>&1 &
VITE_PID=$!

# Wait for Vite to be ready (with liveness check)
for _ in $(seq 1 30); do
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "Vite process died unexpectedly."
    exit 1
  fi
  if curl -s http://localhost:5173 > /dev/null 2>&1; then
    break
  fi
  sleep 0.3
done

URL="http://localhost:5173/#token=$TOKEN"

echo ""
echo "  Hermes Dashboard ready:"
echo ""
echo "  $URL"
echo ""

# Open browser
if command -v open &>/dev/null; then
  open "$URL"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$URL"
fi

# Keep alive
wait
