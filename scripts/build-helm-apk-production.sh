#!/usr/bin/env bash
# Build Helm Android APK pointing at production (deploy/production.env).
# Requires: npx eas-cli login (one-time)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
PROD_ENV="$ROOT/deploy/production.env"

if [ ! -f "$PROD_ENV" ]; then
  echo "✗  Missing $PROD_ENV"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$PROD_ENV"
set +a

API_URL="${NEXT_PUBLIC_APP_URL:-}"
GOOGLE_ID="${GOOGLE_CLIENT_ID:-}"
ANDROID_ID="${GOOGLE_ANDROID_CLIENT_ID:-}"

if [ -z "$API_URL" ] || [ -z "$GOOGLE_ID" ]; then
  echo "✗  Set NEXT_PUBLIC_APP_URL and GOOGLE_CLIENT_ID in deploy/production.env"
  exit 1
fi

if [ -z "$ANDROID_ID" ]; then
  echo "⚠  GOOGLE_ANDROID_CLIENT_ID is empty — Helm Android sign-in needs an Android OAuth client."
  echo "   See docs/deploy/google-oauth-setup.md (package com.alpir.helm + EAS SHA-1)"
  exit 1
fi

if [[ "$API_URL" == *your-domain* ]] || [[ "$API_URL" == http://localhost* ]]; then
  echo "✗  Production URL must be HTTPS (tunnel or domain), got: $API_URL"
  exit 1
fi

cat > "$MOBILE/.env" <<EOF
EXPO_PUBLIC_API_URL=${API_URL}
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${GOOGLE_ID}
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=${ANDROID_ID}
EOF

echo "→ API URL: $API_URL"
echo "→ Google client: ...${GOOGLE_ID: -20}"

if ! npx eas-cli whoami >/dev/null 2>&1; then
  echo ""
  echo "→ Login to Expo first:"
  echo "   npx eas-cli login"
  exit 1
fi

echo "→ Starting EAS cloud build (APK, ~10 min)..."
cd "$MOBILE"
npx eas-cli build --platform android --profile preview --non-interactive

echo ""
echo "✓  Open the build URL from expo.dev on your Android phone to download the APK."
