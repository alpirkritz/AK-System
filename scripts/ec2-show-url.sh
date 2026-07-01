#!/usr/bin/env bash
# Print the current Cloudflare quick-tunnel URL for the EC2 instance.
# Usage: pnpm ec2:url   (or bash scripts/ec2-show-url.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EC2_ENV="$ROOT_DIR/deploy/ec2.env"

if [ ! -f "$EC2_ENV" ]; then
  echo "✗  Missing deploy/ec2.env — run pnpm ec2:up first"
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$EC2_ENV"
set +a

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")
REMOTE="${DEPLOY_USER:-ubuntu}@${DEPLOY_HOST}"

URL="$(ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /var/log/ak-tunnel.log 2>/dev/null | tail -1" || true)"

if [ -z "$URL" ]; then
  echo "✗  No trycloudflare URL found. Check: ssh $REMOTE 'sudo journalctl -u ak-tunnel -n 30'"
  exit 1
fi

echo ""
echo "App URL (free Cloudflare tunnel):"
echo "  $URL"
echo ""
echo "Google OAuth redirect URIs (add both in Google Cloud Console if missing):"
echo "  ${URL}/api/auth/callback/google"
echo "  ${URL}/api/auth/google-calendar/callback"
echo ""
if curl -sf --max-time 10 "${URL}/api/health" >/dev/null 2>&1; then
  echo "✓  Health check OK"
else
  echo "⚠  URL not responding yet — app may still be starting"
fi
echo ""
echo "Tip: avoid 'sudo systemctl restart ak-tunnel' unless needed — restart may change the URL."
