#!/usr/bin/env bash
# Expose the local AK System web app (port 3000) over HTTPS via ngrok's free
# static domain — a stable URL that never changes across restarts, unlike
# `cloudflared tunnel --url` (random *.trycloudflare.com hostname each run).
#
# ⚠  The static domain now belongs to the EC2 instance
# (scripts/ec2-install-ngrok-tunnel.sh, systemd unit ak-ngrok). The ngrok free plan
# allows one online agent per account, so running this here either fails to connect
# or steals the public URL away from production and points it at whatever happens to
# occupy port 3000 on this Mac. Set ALLOW_LOCAL_TUNNEL=1 only for a deliberate,
# temporary takeover — and stop the server side first.
#
# One-time setup (free, no credit card):
#   1. Sign up at https://dashboard.ngrok.com/signup
#   2. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
#      and run:  ngrok config add-authtoken <TOKEN>
#   3. Claim your free static domain at
#      https://dashboard.ngrok.com/domains  (one is free forever)
#   4. Put it in .env.local / env as NGROK_STATIC_DOMAIN=your-name.ngrok-free.app
#   5. After the tunnel is up, run once:
#        bash scripts/set-tunnel-url.sh https://your-name.ngrok-free.app
#      This is a stable domain — you should only need to do this once, ever.

set -euo pipefail

PORT="${WEB_PORT:-3000}"

if [ "${ALLOW_LOCAL_TUNNEL:-0}" != "1" ]; then
  echo "✗  The ngrok static domain is served by EC2 (systemd unit: ak-ngrok)."
  echo "   Running the tunnel here would point the public URL at this Mac's port ${PORT}."
  echo ""
  echo "   Production tunnel:  ssh <ec2> 'systemctl status ak-ngrok'"
  echo "   Local dev:          pnpm dev   → http://localhost:${PORT}"
  echo ""
  echo "   To override anyway (stop ak-ngrok on the server first):"
  echo "     ALLOW_LOCAL_TUNNEL=1 pnpm tunnel:ngrok"
  exit 1
fi

if ! command -v ngrok >/dev/null 2>&1; then
  echo "✗  ngrok not found. Install it first:"
  echo "     brew install ngrok/ngrok/ngrok"
  exit 1
fi

if [ -z "${NGROK_STATIC_DOMAIN:-}" ]; then
  echo "✗  NGROK_STATIC_DOMAIN not set."
  echo "   Claim a free static domain at https://dashboard.ngrok.com/domains"
  echo "   then set NGROK_STATIC_DOMAIN=your-name.ngrok-free.app (in apps/web/.env.local"
  echo "   or exported in your shell) and re-run."
  exit 1
fi

echo "▶  Starting ngrok tunnel → http://127.0.0.1:${PORT}"
echo "   Stable URL: https://${NGROK_STATIC_DOMAIN}"
exec ngrok http "${PORT}" --url="https://${NGROK_STATIC_DOMAIN}"
