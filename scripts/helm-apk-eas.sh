#!/usr/bin/env bash
# Build Helm APK via Expo EAS (cloud) — recommended on Mac without Android Studio.
# Requires one-time: npx eas-cli login
# Output: download URL on expo.dev (open on phone to install APK)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
WEB_ENV="$ROOT/apps/web/.env.local"
PROD_ENV="$ROOT/deploy/production.env"

bash "$ROOT/scripts/check-helm-fcm.sh"

if [ ! -f "$MOBILE/google-services.json" ]; then
  echo "✗  Missing $MOBILE/google-services.json"
  echo "   Without it the APK cannot initialize Firebase (no push token / no banners)."
  echo "   Firebase Console → Project settings → your Android app → download google-services.json"
  exit 1
fi

if [ ! -f "$WEB_ENV" ]; then
  echo "✗  Missing $WEB_ENV"
  exit 1
fi

API_URL="$(grep '^NEXT_PUBLIC_APP_URL=' "$WEB_ENV" | cut -d= -f2- | tr -d '"')"
GOOGLE_ID="$(grep '^GOOGLE_CLIENT_ID=' "$WEB_ENV" | cut -d= -f2- | tr -d '"')"
ANDROID_ID="$(grep '^GOOGLE_ANDROID_CLIENT_ID=' "$WEB_ENV" | cut -d= -f2- | tr -d '"' || true)"

if [ -z "$ANDROID_ID" ] && [ -f "$PROD_ENV" ]; then
  ANDROID_ID="$(grep '^GOOGLE_ANDROID_CLIENT_ID=' "$PROD_ENV" | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$ANDROID_ID" ]; then
  ANDROID_ID="$(python3 -c "import json; print(json.load(open('$MOBILE/eas.json'))['build']['preview']['env'].get('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID',''))" 2>/dev/null || true)"
fi

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

if [[ "$API_URL" == http://localhost* ]]; then
  echo "✗  APK cannot use localhost API URL: $API_URL"
  echo "   Start the tunnel (pnpm serve / setup:push) or set NEXT_PUBLIC_APP_URL to HTTPS."
  exit 1
fi

if [ -z "$ANDROID_ID" ]; then
  echo "✗  GOOGLE_ANDROID_CLIENT_ID missing — Android Google sign-in will fail."
  echo "   Set it in apps/web/.env.local or deploy/production.env (package com.alpir.helm)."
  exit 1
fi

# Local Metro / expo start still use apps/mobile/.env — but EAS cloud upload
# respects the repo root .gitignore, which ignores every `.env`. That file never
# reaches the build worker. Bake EXPO_PUBLIC_* into eas.json env instead.
cat > "$MOBILE/.env" <<EOF
EXPO_PUBLIC_API_URL=${API_URL}
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${GOOGLE_ID}
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=${ANDROID_ID}
EOF

python3 - "$MOBILE/eas.json" "$API_URL" "$GOOGLE_ID" "$ANDROID_ID" <<'PY'
import json, sys
from pathlib import Path
path, api, web, android = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
data = json.loads(path.read_text())
for profile in ("preview", "production"):
    env = data.setdefault("build", {}).setdefault(profile, {}).setdefault("env", {})
    env["EXPO_PUBLIC_API_URL"] = api
    env["EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"] = web
    env["EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID"] = android
path.write_text(json.dumps(data, indent=2) + "\n")
print(f"→ eas.json env updated (API={api})")
PY

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
echo "   Then: הגדרות → הפעל התראות Push → שלח בדיקה"
