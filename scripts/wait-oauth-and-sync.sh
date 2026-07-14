#!/usr/bin/env bash
# Wait for Google OAuth reconnect, then run Outlook → Dragontail sync.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/web/.env.local"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export DATABASE_PATH="$ROOT_DIR/apps/web/data/ak_system.sqlite"

echo "▶  ממתין לחיבור Google מחדש..."
APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
APP_URL="${APP_URL%/}"
echo "   פתח/השלם: ${APP_URL}/api/auth/google-calendar?hint=alpirkritz@gmail.com"
echo ""

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

echo "✗  לא התקבל חיבור Google תוך 5 דקות"
exit 1
