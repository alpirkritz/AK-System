#!/usr/bin/env bash
# Wrapper for the local work-comms bridge (Outlook mail / Slack / Teams).
# Loads apps/web/.env.local, runs the tsx sync, appends to a rotating log.
# Invoked by launchd (deploy/launchd/com.ak.work-comms-bridge.plist) or manually.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/apps/web/.env.local"
LOG_FILE="${WORK_COMMS_LOG:-$HOME/.ak-system/work-comms-bridge.log}"
mkdir -p "$(dirname "$LOG_FILE")"

# Ensure pnpm / node are on PATH under launchd (minimal env).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
if command -v corepack >/dev/null 2>&1; then corepack enable >/dev/null 2>&1 || true; fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Dev server uses DATABASE_PATH=./data/... relative to apps/web; bridge runs from repo root.
export DATABASE_PATH="${DATABASE_PATH:-$ROOT_DIR/apps/web/data/ak_system.sqlite}"

{
  echo "──────── $(date '+%Y-%m-%d %H:%M:%S') ────────"
  pnpm exec tsx "$ROOT_DIR/scripts/work-comms-sync.ts"
} >> "$LOG_FILE" 2>&1
