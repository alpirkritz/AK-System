#!/usr/bin/env bash
# Keep deploy/whatsapp-bridge.env AK_WEBHOOK_URL in sync with the public app URL.
# Usage:
#   bash scripts/sync-bridge-webhook-url.sh
#   bash scripts/sync-bridge-webhook-url.sh https://your-app.trycloudflare.com
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRIDGE_ENV="$ROOT_DIR/deploy/whatsapp-bridge.env"
PROD_ENV="$ROOT_DIR/deploy/production.env"

APP_URL="${1:-}"
if [ -z "$APP_URL" ] && [ -f "$PROD_ENV" ]; then
  APP_URL="$(grep '^NEXT_PUBLIC_APP_URL=' "$PROD_ENV" | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$APP_URL" ] && [ -f "$ROOT_DIR/deploy/ec2.env" ]; then
  # shellcheck disable=SC1090
  source "$ROOT_DIR/deploy/ec2.env"
  APP_URL="${APP_URL:-}"
fi

if [ -z "$APP_URL" ] || [[ "$APP_URL" == *your-domain* ]]; then
  echo "✗  No public APP_URL — pass URL or set NEXT_PUBLIC_APP_URL in deploy/production.env"
  exit 1
fi
APP_URL="${APP_URL%/}"

if [ ! -f "$BRIDGE_ENV" ]; then
  echo "⚠  $BRIDGE_ENV not found — run: pnpm ec2:whatsapp"
  exit 0
fi

set_var() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$BRIDGE_ENV"; then
    if [[ "$(uname)" == Darwin ]]; then
      sed -i '' "s|^${key}=.*|${key}=${val}|" "$BRIDGE_ENV"
    else
      sed -i "s|^${key}=.*|${key}=${val}|" "$BRIDGE_ENV"
    fi
  else
    echo "${key}=${val}" >> "$BRIDGE_ENV"
  fi
}

set_var AK_WEBHOOK_URL "${APP_URL}/api/whatsapp/webhook"
set_var AK_GROUP_SUMMARY_URL "${APP_URL}/api/whatsapp/group-summary"

echo "✓  $BRIDGE_ENV"
echo "   AK_WEBHOOK_URL=${APP_URL}/api/whatsapp/webhook"
