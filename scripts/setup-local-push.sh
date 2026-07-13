#!/usr/bin/env bash
# One-shot local push setup: start production server + tunnel, sync HTTPS URL, verify VAPID.
#
# Usage:
#   bash scripts/setup-local-push.sh          # start everything
#   bash scripts/setup-local-push.sh --sync   # only sync tunnel URL from /tmp/ak-tunnel.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"
LOG="/tmp/ak-tunnel.log"

die() { echo "✗  $*" >&2; exit 1; }

check_vapid() {
  if [ ! -f "$WEB_ENV" ]; then
    die "Missing $WEB_ENV — copy from apps/web/.env.local.example"
  fi
  if ! grep -q '^VAPID_PUBLIC_KEY=.\+' "$WEB_ENV" 2>/dev/null; then
    echo "→ Generating VAPID keys..."
    KEYS="$(npx --yes web-push generate-vapid-keys 2>/dev/null || true)"
    if [ -z "$KEYS" ]; then
      die "Could not generate VAPID keys. Run: npx web-push generate-vapid-keys"
    fi
    PUB="$(echo "$KEYS" | awk '/Public Key/{getline; print}')"
    PRIV="$(echo "$KEYS" | awk '/Private Key/{getline; print}')"
    EMAIL="$(grep '^VAPID_EMAIL=' "$WEB_ENV" | cut -d= -f2- || echo 'mailto:admin@example.com')"
    grep -q '^VAPID_PUBLIC_KEY=' "$WEB_ENV" && \
      sed -i '' "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=${PUB}|" "$WEB_ENV" || \
      echo "VAPID_PUBLIC_KEY=${PUB}" >> "$WEB_ENV"
    grep -q '^VAPID_PRIVATE_KEY=' "$WEB_ENV" && \
      sed -i '' "s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=${PRIV}|" "$WEB_ENV" || \
      echo "VAPID_PRIVATE_KEY=${PRIV}" >> "$WEB_ENV"
    grep -q '^VAPID_EMAIL=' "$WEB_ENV" || echo "VAPID_EMAIL=${EMAIL}" >> "$WEB_ENV"
    echo "✓  VAPID keys written to apps/web/.env.local"
  else
    echo "✓  VAPID keys present"
  fi
}

wait_for_tunnel() {
  local url=""
  for _ in $(seq 1 60); do
    url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 || true)"
    if [ -n "$url" ]; then
      echo "$url"
      return 0
    fi
    sleep 1
  done
  return 1
}

sync_tunnel_url() {
  local url="${1:-}"
  if [ -z "$url" ]; then
    url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 || true)"
  fi
  if [ -z "$url" ]; then
    die "No tunnel URL found in $LOG. Is cloudflared running?"
  fi
  bash "$SCRIPT_DIR/set-tunnel-url.sh" "$url"
  echo "$url"
}

if [ "${1:-}" = "--sync" ]; then
  URL="$(sync_tunnel_url)"
  echo ""
  echo "Tunnel URL: $URL"
  echo "Restart pnpm serve if it was already running."
  exit 0
fi

cd "$ROOT_DIR"
check_vapid

if curl -sf "http://localhost:${PORT:-3000}/api/health" >/dev/null 2>&1; then
  echo "✓  Server already running on :${PORT:-3000}"
else
  echo "→ Starting production server + tunnel (SKIP_BUILD=1)..."
  SKIP_BUILD=1 bash "$SCRIPT_DIR/serve.sh" &
  SERVE_PID=$!
  trap 'kill "$SERVE_PID" 2>/dev/null || true' EXIT
fi

echo "→ Waiting for Cloudflare tunnel URL (up to 60s)..."
URL="$(wait_for_tunnel)" || die "Tunnel did not start. Check: tail -f $LOG"

bash "$SCRIPT_DIR/set-tunnel-url.sh" "$URL"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Push setup ready"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  Tunnel URL:  $URL"
echo ""
echo "  Mac (browser):"
echo "    1. Open $URL in Chrome"
echo "    2. Settings → הפעל נוטיפיקציות → שלח בדיקה"
echo ""
echo "  Phone (Helm APK):"
echo "    1. Rebuild if URL changed: pnpm mobile:apk"
echo "    2. Install APK → Settings → הפעל התראות Push → שלח בדיקה"
echo "    3. If sent but no banner: configure FCM V1 in EAS (eas credentials)"
echo ""
echo "  Phone (PWA — no rebuild):"
echo "    1. Open $URL in Chrome on phone → Add to Home Screen"
echo "    2. Settings → הפעל נוטיפיקציות → שלח בדיקה"
echo ""
echo "  Server log: tail -f $LOG"
echo "════════════════════════════════════════════════════════"

if [ -n "${SERVE_PID:-}" ]; then
  echo ""
  echo "Server running in background (pid $SERVE_PID). Press Ctrl-C to stop."
  wait "$SERVE_PID"
fi
