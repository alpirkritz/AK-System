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

# Persist editable ABC markdown (A_Agents / S_Skills / …) across redeploys.
# Seed from the image without overwriting files the user already edited in the UI.
: "${ABC_ROOT:=/data/abc}"
SEED_ROOT="${ROOT_DIR}/abc-seed"
if [ -d "$SEED_ROOT" ]; then
  echo "→ seeding ABC workspace into ABC_ROOT=$ABC_ROOT (no-clobber)"
  mkdir -p "$ABC_ROOT"
  for dir in A_Agents S_Skills C_Core B_Brain M_Memory O_Output; do
    if [ -d "$SEED_ROOT/$dir" ]; then
      mkdir -p "$ABC_ROOT/$dir"
      # -a archive, -n no-clobber: keep existing edited files; add new ones from image
      cp -an "$SEED_ROOT/$dir"/. "$ABC_ROOT/$dir"/ 2>/dev/null || true
    fi
  done
fi
export ABC_ROOT

echo "→ db:push (DATABASE_PATH=$DATABASE_PATH)"
if ! pnpm db:push; then
  echo "⚠  db:push reported an error (often harmless if schema is already up to date)."
fi

echo "→ starting @ak-system/web (ABC_ROOT=$ABC_ROOT)"
exec pnpm --filter @ak-system/web start
