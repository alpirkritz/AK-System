#!/usr/bin/env bash
# Expose the local AK System web app (port 3000) over HTTPS via Cloudflare Tunnel.
#
# Two modes:
#   1. Named tunnel (stable hostname) — set CLOUDFLARE_TUNNEL_NAME in the env.
#      Requires a one-time setup:
#        cloudflared tunnel login
#        cloudflared tunnel create ak-system
#        cloudflared tunnel route dns ak-system ak.<your-domain>
#      Then run with CLOUDFLARE_TUNNEL_NAME=ak-system.
#   2. Quick tunnel (random *.trycloudflare.com hostname) — default when no name set.
#      Good for testing; the hostname changes each run, so update NEXTAUTH_URL /
#      NEXT_PUBLIC_APP_URL accordingly.

set -euo pipefail

PORT="${WEB_PORT:-3000}"
TARGET="http://localhost:${PORT}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "✗  cloudflared not found. Install it first:"
  echo "     brew install cloudflared"
  exit 1
fi

if [ -n "${CLOUDFLARE_TUNNEL_NAME:-}" ]; then
  echo "▶  Starting named Cloudflare Tunnel '${CLOUDFLARE_TUNNEL_NAME}' → ${TARGET}"
  exec cloudflared tunnel run --url "${TARGET}" "${CLOUDFLARE_TUNNEL_NAME}"
else
  LOG="/tmp/ak-tunnel.log"
  echo "▶  Starting quick Cloudflare Tunnel → ${TARGET}"
  echo "   Log: ${LOG}  (look for *.trycloudflare.com URL)"
  echo "   Then run: bash scripts/set-tunnel-url.sh https://YOUR-URL.trycloudflare.com"
  exec cloudflared tunnel --url "${TARGET}" 2>&1 | tee "$LOG"
fi
