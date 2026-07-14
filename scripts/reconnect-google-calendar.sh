#!/usr/bin/env bash
# One-shot Google Calendar OAuth for the Outlook bridge (local Mac).
# Opens the browser, captures the callback on localhost, stores tokens in SQLite.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/web/.env.local"
PORT="${OAUTH_LOCAL_PORT:-3099}"
REDIRECT_URI="http://127.0.0.1:${PORT}/callback"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗  Missing $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export DATABASE_PATH="$ROOT_DIR/apps/web/data/ak_system.sqlite"
HINT="${1:-alpirkritz@gmail.com}"

echo "▶  Starting local OAuth callback on ${REDIRECT_URI}"
echo "   Account hint: ${HINT}"
echo "   Add this redirect URI in Google Cloud Console if missing:"
echo "   ${REDIRECT_URI}"
echo ""

pnpm exec tsx "$ROOT_DIR/scripts/google-oauth-local.ts" \
  --port "$PORT" \
  --redirect-uri "$REDIRECT_URI" \
  --hint "$HINT"

echo ""
echo "▶  Verifying token..."
pnpm exec tsx "$ROOT_DIR/scripts/repair-google-oauth.ts" verify

echo "▶  Running Outlook → Dragontail sync..."
bash "$HOME/.ak-system/outlook-bridge-run.sh"

echo ""
echo "✓  Done. Check ~/.ak-system/outlook-bridge.log for sync results."
