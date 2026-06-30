#!/usr/bin/env bash
# Push Drizzle schema to SQLite. Tolerates drizzle-kit duplicate-index noise when the
# index was already created by runtime bootstrap (packages/database/src/index.ts).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="${DATABASE_PATH:-$ROOT_DIR/apps/web/data/ak_system.sqlite}"

mkdir -p "$(dirname "$DB_PATH")"
export DATABASE_PATH="$DB_PATH"

set +e
OUTPUT="$(pnpm --filter @ak-system/database run push 2>&1)"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "$OUTPUT"
  exit 0
fi

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q "idx_push_subscriptions_endpoint already exists"; then
  if sqlite3 "$DB_PATH" "SELECT 1 FROM sqlite_master WHERE name='idx_push_subscriptions_endpoint';" | grep -q 1; then
    echo "✓  push_subscriptions index already present — schema OK"
    exit 0
  fi
fi

exit "$STATUS"
