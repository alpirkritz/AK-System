#!/usr/bin/env bash
# Run AK System in PRODUCTION mode so the PWA service worker + Web Push work.
#
# The Serwist service worker is disabled in `next dev` (see apps/web/next.config.js),
# so push notifications only work against a production build. This script:
#   1. ensures the SQLite schema is pushed
#   2. builds the web app (skip with SKIP_BUILD=1)
#   3. starts the web app on PORT (default 3000)
#   4. starts the WhatsApp bridge (skip with SKIP_BRIDGE=1)
#   5. starts the Cloudflare Tunnel (skip with SKIP_TUNNEL=1)
#
# Ctrl-C stops all child processes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PORT="${PORT:-3000}"

PIDS=()
cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "■  Stopping AK System..."
  if ((${#PIDS[@]} > 0)); then
    for pid in "${PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

cd "$ROOT_DIR"

echo "▶  Ensuring database schema..."
if ! pnpm db:push; then
  echo "⚠  db:push reported an error (often harmless if the DB schema is already up to date)."
  echo "   Continuing startup..."
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "▶  Building web app (production)..."
  pnpm build
fi

echo "▶  Starting web app (production) on :${PORT}..."
pnpm --filter @ak-system/web start &
PIDS+=($!)

if [ "${SKIP_BRIDGE:-0}" != "1" ]; then
  echo "▶  Starting WhatsApp bridge..."
  # Bridge must listen on 3001 — do not inherit PORT=3000 from the web app above.
  PORT=3001 pnpm whatsapp-bridge:dev &
  PIDS+=($!)
fi

if [ "${SKIP_TUNNEL:-0}" != "1" ]; then
  echo "▶  Starting Cloudflare Tunnel..."
  bash "$SCRIPT_DIR/tunnel.sh" &
  PIDS+=($!)
fi

echo ""
echo "✓  AK System is starting. Web on http://localhost:${PORT}"
echo "   Push notifications require opening the app via the HTTPS tunnel URL."
echo "   1. Watch /tmp/ak-tunnel.log for the *.trycloudflare.com URL"
echo "   2. Run: bash scripts/set-tunnel-url.sh https://YOUR-URL.trycloudflare.com"
echo "   3. Restart serve (Ctrl-C then pnpm serve again)"
echo ""

wait
