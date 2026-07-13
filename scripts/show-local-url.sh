#!/usr/bin/env bash
# Print the current local Cloudflare quick-tunnel URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
URL_FILE="$ROOT_DIR/deploy/tunnel.url"
LOG="/tmp/ak-tunnel.log"

URL=""
if [ -f "$URL_FILE" ]; then
  URL="$(tr -d '[:space:]' < "$URL_FILE")"
fi
if [ -z "$URL" ] && [ -f "$LOG" ]; then
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 || true)"
fi
if [ -z "$URL" ] && [ -f "$ROOT_DIR/apps/web/.env.local" ]; then
  URL="$(grep '^NEXT_PUBLIC_APP_URL=' "$ROOT_DIR/apps/web/.env.local" | cut -d= -f2- | tr -d '"')"
fi

if [ -z "$URL" ] || [[ "$URL" == http://localhost* ]]; then
  echo "✗  No tunnel URL. Start the server first:"
  echo "     pnpm serve"
  exit 1
fi

echo ""
echo "App URL (Cloudflare tunnel):"
echo "  $URL"
echo ""
if curl -sf --max-time 10 "${URL}/api/health" >/dev/null 2>&1; then
  echo "✓  Health check OK"
else
  echo "✗  Tunnel not responding (Error 1033?) — restart: pnpm serve"
  echo "   Mac fallback (no tunnel): http://localhost:3000"
fi
echo ""
