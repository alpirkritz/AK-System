#!/usr/bin/env bash
# Read Cloudflare tunnel URL from the server log and update deploy/production.env URLs.
# Run ON the EC2 instance (or via SSH from deploy script).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/production.env"
LOG_FILE="/var/log/ak-tunnel.log"
URL_FILE="$ROOT_DIR/deploy/tunnel.url"

TUNNEL_URL="${1:-}"
if [ -z "$TUNNEL_URL" ]; then
  for src in "$URL_FILE" /tmp/ak-tunnel.url "$LOG_FILE"; do
    if [ -f "$src" ]; then
      TUNNEL_URL="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$src" 2>/dev/null | head -1 || true)"
      [ -n "$TUNNEL_URL" ] && break
    fi
  done
fi

if [ -z "$TUNNEL_URL" ]; then
  echo "✗  No tunnel URL found. Install tunnel first: sudo bash scripts/ec2-install-tunnel.sh"
  exit 1
fi
TUNNEL_URL="${TUNNEL_URL%/}"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗  Missing $ENV_FILE"
  exit 1
fi

set_var() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

set_var NEXT_PUBLIC_APP_URL "$TUNNEL_URL"
set_var NEXTAUTH_URL "$TUNNEL_URL"

echo "✓  Updated $ENV_FILE → $TUNNEL_URL"
echo ""
echo "Restart web container:"
echo "  cd $ROOT_DIR && docker compose -f deploy/docker-compose.production.yml up -d"
echo ""
echo "Google OAuth redirect URI:"
echo "  ${TUNNEL_URL}/api/auth/callback/google"
