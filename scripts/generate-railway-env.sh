#!/usr/bin/env bash
# Generate deploy/railway.env from apps/web/.env.local for Railway Variables paste.
# Output is git-ignored — never commit secrets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"
OUT="$ROOT_DIR/deploy/railway.env"

if [ ! -f "$WEB_ENV" ]; then
  echo "✗  Missing $WEB_ENV"
  exit 1
fi

RAILWAY_URL="${1:-}"
if [ -z "$RAILWAY_URL" ]; then
  echo "Usage: bash scripts/generate-railway-env.sh https://your-app.up.railway.app"
  echo "   Or set RAILWAY_URL env var."
  exit 1
fi
RAILWAY_URL="${RAILWAY_URL%/}"

get_var() {
  grep "^${1}=" "$WEB_ENV" | cut -d= -f2- | tr -d '"' || true
}

CRON_SECRET="$(get_var CRON_SECRET)"
if [ -z "$CRON_SECRET" ]; then
  CRON_SECRET="$(openssl rand -base64 32)"
  echo "→ Generated new CRON_SECRET (add to GitHub Actions secrets too)"
fi

cat > "$OUT" <<EOF
# Generated $(date -u +%Y-%m-%dT%H:%MZ) — paste into Railway Variables
NEXT_PUBLIC_APP_URL=${RAILWAY_URL}
NEXTAUTH_URL=${RAILWAY_URL}
NEXTAUTH_SECRET=$(get_var NEXTAUTH_SECRET)
ALLOWED_EMAILS=$(get_var ALLOWED_EMAILS)
DATABASE_PATH=/data/ak_system.sqlite
GOOGLE_CLIENT_ID=$(get_var GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_SECRET=$(get_var GOOGLE_CLIENT_SECRET)
GOOGLE_ANDROID_CLIENT_ID=$(get_var GOOGLE_ANDROID_CLIENT_ID)
GOOGLE_CALENDAR_CLIENT_ID=$(get_var GOOGLE_CALENDAR_CLIENT_ID)
GOOGLE_CALENDAR_CLIENT_SECRET=$(get_var GOOGLE_CALENDAR_CLIENT_SECRET)
GOOGLE_CALENDAR_REFRESH_TOKEN=$(get_var GOOGLE_CALENDAR_REFRESH_TOKEN)
CRON_SECRET=${CRON_SECRET}
VAPID_PUBLIC_KEY=$(get_var VAPID_PUBLIC_KEY)
VAPID_PRIVATE_KEY=$(get_var VAPID_PRIVATE_KEY)
VAPID_EMAIL=$(get_var VAPID_EMAIL)
GEMINI_API_KEY=$(get_var GEMINI_API_KEY)
GEMINI_MODEL=$(get_var GEMINI_MODEL)
TELEGRAM_BOT_TOKEN=$(get_var TELEGRAM_BOT_TOKEN)
TELEGRAM_ALLOWED_CHAT_ID=$(get_var TELEGRAM_ALLOWED_CHAT_ID)
NOTION_API_KEY=$(get_var NOTION_API_KEY)
NOTION_USER_NAME=$(get_var NOTION_USER_NAME)
WHATSAPP_BRIDGE_SECRET=$(get_var WHATSAPP_BRIDGE_SECRET)
TIMEZONE=Asia/Jerusalem
EOF

echo "✓  Wrote $OUT"
echo ""
echo "Next:"
echo "  1. Railway → Variables → paste from deploy/railway.env"
echo "  2. GitHub → Settings → Secrets → CRON_SECRET + APP_URL=${RAILWAY_URL}"
echo "  3. Google OAuth redirect: ${RAILWAY_URL}/api/auth/callback/google"
