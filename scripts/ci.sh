#!/usr/bin/env bash
# Local CI for AK System — replaces external CI/CD.
# Run: pnpm run ci:local   (not `pnpm ci` — that is a reserved pnpm command)
# Runs lint, tests, e2e, and a production build, failing fast on the first error.
#
# Flags (env vars):
#   SKIP_LINT=1     skip `pnpm -r run lint`
#   SKIP_TEST=1     skip `pnpm test` (Vitest API/integration)
#   SKIP_E2E=1      skip `pnpm e2e` (Playwright — slowest stage)
#   SKIP_BUILD=1    skip `pnpm build`
#   DEPLOY_CHECK=1  validate deploy/production.env after the build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

step() { echo ""; echo "━━ $* ━━"; }

if [ "${SKIP_LINT:-0}" != "1" ]; then
  step "lint"
  pnpm -r run lint
fi

if [ "${SKIP_TEST:-0}" != "1" ]; then
  step "test (Vitest)"
  pnpm test
fi

if [ "${SKIP_E2E:-0}" != "1" ]; then
  step "e2e (Playwright)"
  pnpm e2e
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  step "build"
  # AK_DEPLOY_BUILD=1 makes next.config.js write to apps/web/.next instead of
  # /tmp — required so deploy-ec2.sh's rsync (which reads apps/web/.next) picks
  # up this build. Without it, deploy-ec2.sh silently ships a stale bundle.
  AK_DEPLOY_BUILD=1 pnpm build
fi

if [ "${DEPLOY_CHECK:-0}" = "1" ]; then
  step "validate production env"
  ENV_FILE="$ROOT_DIR/deploy/production.env"
  if [ ! -f "$ENV_FILE" ]; then
    echo "✗  $ENV_FILE missing. Run: bash scripts/generate-production-env.sh <APP_URL>"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  bash "$SCRIPT_DIR/validate-production-env.sh"
fi

echo ""
echo "✓  CI passed."
