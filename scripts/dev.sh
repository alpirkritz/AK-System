#!/usr/bin/env bash
# Start the AK System dev server and eagerly pre-compile all routes.
# On Google Drive the webpack cache can't use inode/mtime snapshots, so every
# fresh startup must re-compile the 1 300-module bundle. This script waits for
# the server to be ready and then fires background curl requests to trigger all
# page compilations upfront – so the user never waits on first visit.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="/tmp/ak-dev.log"
BASE_URL="http://localhost:3000"

ROUTES=("/" "/calendar" "/tasks" "/projects" "/meetings" "/people" "/conversations")
TRPC_ROUTES=(
  "calendar.isConnected?batch=1&input=%7B%7D"
)

echo "▶  Starting AK System dev server..."
cd "$ROOT_DIR/apps/web"
pnpm dev >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "   PID: $SERVER_PID  •  Log: $LOG_FILE"

# Wait for "Ready" in the log (up to 60 s)
WAIT=0
while ! grep -q "Ready" "$LOG_FILE" 2>/dev/null; do
  sleep 2
  WAIT=$((WAIT + 2))
  if [ $WAIT -ge 120 ]; then
    echo "✗  Server did not start within 120 s. Check $LOG_FILE"
    exit 1
  fi
done

READY_LINE=$(grep "Ready" "$LOG_FILE")
echo "✓  Server ready: $READY_LINE"
echo ""
echo "⚡ Pre-compiling all routes (first visit = slow on Google Drive)..."

# Fire requests in parallel; the server compiles lazily on first hit
PIDS=()
for route in "${ROUTES[@]}"; do
  curl -s "$BASE_URL$route" -o /dev/null &
  PIDS+=($!)
done
for trpc in "${TRPC_ROUTES[@]}"; do
  curl -s "$BASE_URL/api/trpc/$trpc" -o /dev/null &
  PIDS+=($!)
done

# Wait for all requests and report
for pid in "${PIDS[@]}"; do wait "$pid"; done

echo ""
echo "✓  All routes compiled. The app is ready at $BASE_URL"
echo "   Calendar events load in ~2-5 s (Apple Calendar cache warms in background)."
echo ""

# Keep the server process in the foreground so the script doesn't exit
wait $SERVER_PID
