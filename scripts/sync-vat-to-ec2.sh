#!/usr/bin/env bash
# Push local vat_entries into the EC2 production SQLite (Docker volume).
#
# Upserts by primary key (id). Does not delete remote rows that are absent locally.
#
# Usage (from repo root):
#   bash scripts/sync-vat-to-ec2.sh
#
# Requires: deploy/ec2.env, SSH access, docker compose web container running on EC2.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

EC2_ENV="$ROOT_DIR/deploy/ec2.env"
if [ ! -f "$EC2_ENV" ]; then
  echo "✗  Missing $EC2_ENV"
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$EC2_ENV"
set +a

: "${DEPLOY_HOST:?set DEPLOY_HOST in deploy/ec2.env}"
: "${DEPLOY_USER:=ubuntu}"
: "${DEPLOY_PATH:=/opt/ak-system}"
SSH_KEY="${SSH_KEY:-}"
COMPOSE_FILE="deploy/docker-compose.production.yml"
LOCAL_DB="${DATABASE_PATH:-$ROOT_DIR/apps/web/data/ak_system.sqlite}"

if [ ! -f "$LOCAL_DB" ]; then
  echo "✗  Local DB not found: $LOCAL_DB"
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
[ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SQL_FILE="$TMP_DIR/vat_entries.sql"
APPLY_JS="$TMP_DIR/apply-vat.mjs"
COUNT_FILE="$TMP_DIR/count.txt"

echo "→ Exporting vat_entries from $LOCAL_DB"
(
  cd "$ROOT_DIR/packages/database"
  LOCAL_DB="$LOCAL_DB" SQL_FILE="$SQL_FILE" COUNT_FILE="$COUNT_FILE" node --import tsx <<'EOF'
import Database from "better-sqlite3"
import * as fs from "fs"

const db = new Database(process.env.LOCAL_DB!, { readonly: true })
const rows = db.prepare("SELECT * FROM vat_entries").all() as Record<string, unknown>[]
fs.writeFileSync(process.env.COUNT_FILE!, String(rows.length))

function esc(v: unknown): string {
  if (v === null || v === undefined) return "NULL"
  if (typeof v === "number") return String(v)
  return "'" + String(v).replace(/'/g, "''") + "'"
}

const cols = [
  "id", "year", "period", "tax_code", "category", "entry_type", "date",
  "invoice_number", "description", "amount", "is_vat_exempt",
  "deduction_percent", "dollar_rate", "invoice_file_url", "created_at",
] as const

const lines: string[] = [
  `CREATE TABLE IF NOT EXISTS vat_entries (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  tax_code TEXT NOT NULL,
  category TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  date TEXT NOT NULL,
  invoice_number TEXT,
  description TEXT NOT NULL,
  amount TEXT NOT NULL,
  is_vat_exempt INTEGER NOT NULL DEFAULT 0,
  deduction_percent TEXT,
  dollar_rate TEXT,
  invoice_file_url TEXT,
  created_at TEXT NOT NULL
);`,
  "BEGIN;",
]

for (const r of rows) {
  const values = cols.map((c) => esc(r[c])).join(", ")
  lines.push(`INSERT OR REPLACE INTO vat_entries (${cols.join(", ")}) VALUES (${values});`)
}
lines.push("COMMIT;")
fs.writeFileSync(process.env.SQL_FILE!, lines.join("\n") + "\n")
db.close()
console.log("   exported", rows.length, "rows")
EOF
)

# Small apply script run inside the web container
cat > "$APPLY_JS" <<'EOF'
import Database from "better-sqlite3";
import fs from "fs";
const sql = fs.readFileSync("/tmp/vat_entries_sync.sql", "utf8");
const db = new Database("/data/ak_system.sqlite");
db.exec(sql);
const n = db.prepare("SELECT COUNT(*) AS n FROM vat_entries").get();
console.log("remote vat_entries count:", n.n);
db.close();
EOF

LOCAL_COUNT="$(cat "$COUNT_FILE")"
echo "→ Uploading dump ($LOCAL_COUNT rows) → $REMOTE"
scp "${SSH_OPTS[@]}" "$SQL_FILE" "${REMOTE}:/tmp/vat_entries_sync.sql"
scp "${SSH_OPTS[@]}" "$APPLY_JS" "${REMOTE}:/tmp/apply-vat.mjs"

echo "→ Applying into container DB /data/ak_system.sqlite"
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "cd '$DEPLOY_PATH' && \
   (docker compose -f '$COMPOSE_FILE' ps -q web || sudo docker compose -f '$COMPOSE_FILE' ps -q web) >/tmp/ak_web_cid && \
   CID=\$(cat /tmp/ak_web_cid) && \
   test -n \"\$CID\" || { echo '✗ web container not running'; exit 1; } && \
   (docker cp /tmp/vat_entries_sync.sql \$CID:/tmp/vat_entries_sync.sql || sudo docker cp /tmp/vat_entries_sync.sql \$CID:/tmp/vat_entries_sync.sql) && \
   (docker cp /tmp/apply-vat.mjs \$CID:/app/packages/database/_apply-vat.mjs || sudo docker cp /tmp/apply-vat.mjs \$CID:/app/packages/database/_apply-vat.mjs) && \
   (docker exec -w /app/packages/database \$CID node _apply-vat.mjs || sudo docker exec -w /app/packages/database \$CID node _apply-vat.mjs) && \
   (docker exec \$CID rm -f /app/packages/database/_apply-vat.mjs /tmp/vat_entries_sync.sql || sudo docker exec \$CID rm -f /app/packages/database/_apply-vat.mjs /tmp/vat_entries_sync.sql || true)"

echo ""
echo "✓  Synced $LOCAL_COUNT local vat_entries → EC2"
echo "   Re-run anytime: bash scripts/sync-vat-to-ec2.sh"
