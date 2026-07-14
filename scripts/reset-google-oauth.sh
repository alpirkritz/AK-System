#!/usr/bin/env bash
# Reset broken Google OAuth for the Outlook bridge and open a fresh consent flow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB="$ROOT_DIR/apps/web/data/ak_system.sqlite"
ENV_FILE="$ROOT_DIR/apps/web/.env.local"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

APP_URL="${BRIDGE_OAUTH_URL:-http://localhost:3000}"
APP_URL="${APP_URL%/}"
EMAIL="${1:-alpirkritz@gmail.com}"

echo "▶  מוחק טוקן Google שבור מ-SQLite..."
sqlite3 "$DB" "DELETE FROM google_connections WHERE calendar_email='${EMAIL}';"

echo "▶  פתח בדפדפן ואשר מחדש (חובה refresh token חדש):"
OAUTH_URL="${APP_URL}/api/auth/google-calendar?hint=${EMAIL}"
echo "   ${OAUTH_URL}"
open "$OAUTH_URL"

export DATABASE_PATH="$DB"
echo ""
echo "▶  ממתין לחיבור (עד 5 דקות)..."
for _ in $(seq 1 60); do
  if pnpm exec tsx "$ROOT_DIR/scripts/repair-google-oauth.ts" verify >/dev/null 2>&1; then
    echo "✓  טוקן Google תקין"
    bash "$HOME/.ak-system/outlook-bridge-run.sh"
    echo ""
    tail -6 "$HOME/.ak-system/outlook-bridge.log"
    exit 0
  fi
  sleep 5
done

echo "✗  לא התקבל refresh token חדש."
echo "   הסר גישה ב-https://myaccount.google.com/permissions ואז הרץ שוב:"
echo "   bash scripts/reset-google-oauth.sh"
exit 1
