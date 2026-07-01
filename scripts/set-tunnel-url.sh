#!/usr/bin/env bash
# Set HTTPS tunnel URL in web + WhatsApp bridge env files.
# Usage: bash scripts/set-tunnel-url.sh https://your-subdomain.trycloudflare.com

set -euo pipefail

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "Usage: bash scripts/set-tunnel-url.sh https://your-tunnel-url"
  exit 1
fi

# Strip trailing slash
URL="${URL%/}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"
BRIDGE_ENV="$ROOT_DIR/apps/whatsapp-bridge/.env"

for f in "$WEB_ENV" "$BRIDGE_ENV"; do
  if [ ! -f "$f" ]; then
    echo "✗  Missing $f"
    exit 1
  fi
done

set_var() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

set_var "$WEB_ENV" NEXTAUTH_URL "$URL"
set_var "$WEB_ENV" NEXT_PUBLIC_APP_URL "$URL"
set_var "$BRIDGE_ENV" AK_WEBHOOK_URL "${URL}/api/whatsapp/webhook"

MOBILE_ENV="$ROOT_DIR/apps/mobile/.env"
GOOGLE_ID="$(grep '^GOOGLE_CLIENT_ID=' "$WEB_ENV" | cut -d= -f2- | tr -d '"' || true)"
if [ -f "$MOBILE_ENV" ] || [ -n "$GOOGLE_ID" ]; then
  cat > "$MOBILE_ENV" <<EOF
EXPO_PUBLIC_API_URL=${URL}
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${GOOGLE_ID}
EOF
  echo "   apps/mobile/.env: EXPO_PUBLIC_API_URL, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"
fi

echo "✓  Updated tunnel URL to $URL"
echo "   apps/web/.env.local: NEXTAUTH_URL, NEXT_PUBLIC_APP_URL"
echo "   apps/whatsapp-bridge/.env: AK_WEBHOOK_URL"
echo ""
echo "Next: add to Google Cloud Console → OAuth redirect URI:"
echo "   ${URL}/api/auth/callback/google"
echo ""
echo "Restart: pnpm serve  (or restart web + bridge if already running)"
