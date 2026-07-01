#!/usr/bin/env bash
# Production start (EC2 / Docker / any host): ensure SQLite schema then run Next.js.
# Used as the container CMD and by legacy scripts/railway-start.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

: "${DATABASE_PATH:=/data/ak_system.sqlite}"
export DATABASE_PATH

mkdir -p "$(dirname "$DATABASE_PATH")"

echo "→ db:push (DATABASE_PATH=$DATABASE_PATH)"
if ! pnpm db:push; then
  echo "⚠  db:push reported an error (often harmless if schema is already up to date)."
fi

echo "→ starting @ak-system/web"
exec pnpm --filter @ak-system/web start
