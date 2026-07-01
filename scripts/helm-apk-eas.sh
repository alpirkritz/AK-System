#!/usr/bin/env bash
# Build Helm APK via Expo EAS (cloud) — recommended on Mac without Android Studio.
# Requires one-time: npx eas-cli login
# Output: download URL on expo.dev (open on phone to install APK)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
WEB_ENV="$ROOT/apps/web/.env.local"

if [ ! -f "$WEB_ENV" ]; then
  echo "✗  Missing $WEB_ENV"
  exit 1
fi

API_URL="$(grep '^NEXT_PUBLIC_APP_URL=' "$WEB_ENV" | cut -d= -f2- | tr -d '"')"
GOOGLE_ID="$(grep '^GOOGLE_CLIENT_ID=' "$WEB_ENV" | cut -d= -f2- | tr -d '"')"

if [[ "$API_URL" == http://localhost:* ]] || [[ "$API_URL" == "http://localhost:3000" ]]; then
  if [ -f /tmp/ak-tunnel.log ]; then
    TUNNEL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/ak-tunnel.log | tail -1 || true)"
    if [ -n "$TUNNEL" ]; then
      echo "→ Using tunnel URL: $TUNNEL"
      API_URL="$TUNNEL"
    fi
  fi
fi

if [ -z "$API_URL" ] || [ -z "$GOOGLE_ID" ]; then
  echo "✗  Set NEXT_PUBLIC_APP_URL and GOOGLE_CLIENT_ID in apps/web/.env.local"
  exit 1
fi

cat > "$MOBILE/.env" <<EOF
EXPO_PUBLIC_API_URL=${API_URL}
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${GOOGLE_ID}
EOF

if ! npx eas-cli whoami >/dev/null 2>&1; then
  echo "→ Login to Expo first:"
  echo "   npx eas-cli login"
  exit 1
fi

echo "→ Starting EAS cloud build (APK, ~10 min)..."
echo "   API baked in: $API_URL"
cd "$MOBILE"
npx eas-cli build --platform android --profile preview --non-interactive

echo ""
echo "✓  When done, open the build URL from expo.dev on your phone to download the APK."
