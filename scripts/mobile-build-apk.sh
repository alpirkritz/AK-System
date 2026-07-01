#!/usr/bin/env bash
# Build Helm Android APK via EAS (preview profile).
# Prerequisites: eas login, eas init, apps/mobile/.env with EXPO_PUBLIC_API_URL
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"

cd "$MOBILE_DIR"

if [ ! -f .env ]; then
  echo "❌ Missing apps/mobile/.env — copy from .env.example and set EXPO_PUBLIC_API_URL"
  echo "   See docs/deploy/helm-apk-build.md"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [ -z "${EXPO_PUBLIC_API_URL:-}" ]; then
  echo "❌ EXPO_PUBLIC_API_URL is empty in apps/mobile/.env"
  exit 1
fi

if ! command -v eas >/dev/null 2>&1; then
  echo "→ using npx eas-cli"
  EAS="npx --yes eas-cli"
else
  EAS="eas"
fi

if ! $EAS whoami >/dev/null 2>&1; then
  echo "❌ Not logged in to Expo. Run: cd apps/mobile && eas login"
  exit 1
fi

PROJECT_ID=$(grep -o "projectId: '[^']*'" app.config.ts 2>/dev/null | head -1 || true)
if grep -q 'REPLACE_WITH_eas_init' app.config.ts 2>/dev/null; then
  echo "⚠  EAS project not linked. Run: cd apps/mobile && eas init"
  echo "   Then re-run this script."
  exit 1
fi

echo "→ Building APK (profile: preview, API: $EXPO_PUBLIC_API_URL)"
$EAS build --platform android --profile preview --non-interactive

echo "✓ Build submitted. Download APK from the Expo dashboard when complete."
