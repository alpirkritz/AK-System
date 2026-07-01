#!/usr/bin/env bash
# Build Helm debug APK: prebuild on host (pnpm), Gradle in Docker (linux/amd64).
# Output: apps/web/public/helm.apk → download at ${NEXT_PUBLIC_APP_URL}/helm.apk
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
WEB_ENV="$ROOT/apps/web/.env.local"
OUT="$ROOT/apps/web/public/helm.apk"
IMAGE="ak-helm-android-builder"

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
      echo "→ Using tunnel URL from /tmp/ak-tunnel.log: $TUNNEL"
      API_URL="$TUNNEL"
    fi
  fi
fi

if [ -z "$API_URL" ] || [ -z "$GOOGLE_ID" ]; then
  echo "✗  NEXT_PUBLIC_APP_URL and GOOGLE_CLIENT_ID must be set in apps/web/.env.local"
  exit 1
fi

cat > "$MOBILE/.env" <<EOF
EXPO_PUBLIC_API_URL=${API_URL}
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${GOOGLE_ID}
EOF

echo "→ Ensuring pnpm dependencies..."
(cd "$ROOT" && pnpm install --filter @ak-system/mobile...)

if [ ! -d "$MOBILE/android" ]; then
  echo "→ expo prebuild (host)..."
  (cd "$MOBILE" && npx expo prebuild --platform android --no-install)
fi

# Low-memory profile — native clang under x86 emulation OOMs the 7.75GB Docker VM
# when run in parallel. Force single-threaded compile + small JVM heap.
GRADLE_PROPS="$MOBILE/android/gradle.properties"
set_prop() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$GRADLE_PROPS" 2>/dev/null; then
    sed -i '' "s|^${key}=.*|${key}=${val}|" "$GRADLE_PROPS"
  else
    echo "${key}=${val}" >> "$GRADLE_PROPS"
  fi
}
set_prop 'org.gradle.jvmargs' '-Xmx1536m -XX:MaxMetaspaceSize=384m'
set_prop 'org.gradle.workers.max' '1'
set_prop 'org.gradle.parallel' 'false'
set_prop 'org.gradle.daemon' 'false'
# Build only arm64-v8a (Galaxy Fold 7) — ~4x faster + avoids OOM on the
# 7.75GB Docker VM when cross-compiling all ABIs under x86 emulation.
# Override with HELM_ALL_ABIS=1 to build every architecture.
if [ "${HELM_ALL_ABIS:-0}" != "1" ]; then
  if grep -q '^reactNativeArchitectures=' "$GRADLE_PROPS" 2>/dev/null; then
    sed -i '' 's|^reactNativeArchitectures=.*|reactNativeArchitectures=arm64-v8a|' "$GRADLE_PROPS"
  else
    echo 'reactNativeArchitectures=arm64-v8a' >> "$GRADLE_PROPS"
  fi
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "→ Building Docker image (one-time)..."
  docker build --platform linux/amd64 -t "$IMAGE" -f "$ROOT/scripts/Dockerfile.helm-android" "$ROOT/scripts"
fi

# Stop stale Gradle containers that may hold .gradle locks
docker ps -q --filter ancestor="$IMAGE" | xargs -r docker stop 2>/dev/null || true
rm -rf "$MOBILE/android/.gradle"

echo "→ Gradle assembleDebug (Docker amd64, single-threaded, ~20–40 min)..."
# CMAKE_BUILD_PARALLEL_LEVEL=1 → one clang process at a time (keeps peak RAM low)
docker run --rm --platform linux/amd64 \
  -v "$ROOT:/monorepo" \
  -w /monorepo/apps/mobile/android \
  -e GRADLE_OPTS="-Xmx1536m -Dorg.gradle.daemon=false" \
  -e CMAKE_BUILD_PARALLEL_LEVEL=1 \
  -e ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a \
  "$IMAGE" \
  ./gradlew assembleDebug -x lint --no-daemon --max-workers=1

APK="$MOBILE/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "✗  APK not found at $APK"
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
cp "$APK" "$OUT"
echo ""
echo "✓  APK ready: $OUT"
echo "✓  Download on phone:"
echo "   ${API_URL}/helm.apk"
echo ""
echo "Make sure pnpm serve is running so the tunnel serves the file."
