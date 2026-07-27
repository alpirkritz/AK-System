#!/usr/bin/env bash
# Import the production Google Calendar token into the Mac bridge's local SQLite.
# Production Settings is the OAuth source of truth; no local web server is needed.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EC2_ENV="$ROOT_DIR/deploy/ec2.env"
REPO_ENV="$ROOT_DIR/apps/web/.env.local"
PROD_ENV="$ROOT_DIR/deploy/production.env"
ACCOUNT="${1:-${OUTLOOK_BRIDGE_ACCOUNT:-alpirkritz@gmail.com}}"

[ -f "$EC2_ENV" ] || { echo "[token-import] missing $EC2_ENV"; exit 1; }

set -a
# shellcheck disable=SC1090
[ -f "$REPO_ENV" ] && source "$REPO_ENV"
# Prefer the OAuth client credentials used by production.
# shellcheck disable=SC1090
[ -f "$PROD_ENV" ] && source "$PROD_ENV"
# shellcheck disable=SC1090
source "$EC2_ENV"
set +a

: "${DEPLOY_HOST:?set DEPLOY_HOST in deploy/ec2.env}"
: "${DEPLOY_USER:=ubuntu}"
: "${DEPLOY_PATH:=/opt/ak-system}"

if [[ ! "$ACCOUNT" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]]; then
  echo "[token-import] invalid account email"
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
COMPOSE_FILE="deploy/docker-compose.production.yml"

# Keep SSH available after the Mac's public IP changes. Failure is handled by
# the normal local-token fallback in the bridge runner.
if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
  bash "$ROOT_DIR/scripts/ec2-ensure-ssh-access.sh" >/dev/null || true
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
EXTRACT_JS="$TMP_DIR/export-google-token.mjs"
TOKEN_JSON="$TMP_DIR/google-token.json"
REMOTE_SCRIPT="/tmp/ak-export-google-token.mjs"

cat > "$EXTRACT_JS" <<'EOF'
import Database from 'better-sqlite3'

const email = process.argv[2]
const db = new Database('/data/ak_system.sqlite', { readonly: true })
try {
  const row = db.prepare(`
    SELECT calendar_email, access_token, refresh_token, token_expires_at
    FROM google_connections
    WHERE lower(calendar_email) = lower(?)
    LIMIT 1
  `).get(email)
  if (!row?.refresh_token) {
    console.error(`no production refresh token for ${email}`)
    process.exit(2)
  }
  process.stdout.write(JSON.stringify(row))
} finally {
  db.close()
}
EOF

chmod 600 "$EXTRACT_JS"
scp "${SSH_OPTS[@]}" -q "$EXTRACT_JS" "${REMOTE}:${REMOTE_SCRIPT}"

if ! ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "cd '$DEPLOY_PATH' && \
   (docker compose -f '$COMPOSE_FILE' ps -q web || sudo docker compose -f '$COMPOSE_FILE' ps -q web) 2>/dev/null >/tmp/ak_web_cid && \
   CID=\$(cat /tmp/ak_web_cid) && \
   test -n \"\$CID\" || { echo 'web container not running' >&2; exit 1; } && \
   (docker cp '$REMOTE_SCRIPT' \"\$CID\":/app/packages/database/_export-google-token.mjs || sudo docker cp '$REMOTE_SCRIPT' \"\$CID\":/app/packages/database/_export-google-token.mjs) >/dev/null && \
   (docker exec -w /app/packages/database \"\$CID\" node _export-google-token.mjs '$ACCOUNT' || sudo docker exec -w /app/packages/database \"\$CID\" node _export-google-token.mjs '$ACCOUNT'); \
   RC=\$?; \
   (docker exec \"\$CID\" rm -f /app/packages/database/_export-google-token.mjs || sudo docker exec \"\$CID\" rm -f /app/packages/database/_export-google-token.mjs || true) >/dev/null 2>&1; \
   rm -f '$REMOTE_SCRIPT'; \
   exit \$RC" > "$TOKEN_JSON"; then
  echo "[token-import] unable to export $ACCOUNT from EC2"
  exit 1
fi

chmod 600 "$TOKEN_JSON"
# This script always imports into the Mac bridge DB. production.env contains
# DATABASE_PATH=/data/... for the container and must not leak into this process.
export DATABASE_PATH="$ROOT_DIR/apps/web/data/ak_system.sqlite"
cd "$ROOT_DIR"
pnpm exec tsx scripts/import-google-token-from-prod.ts --json "$TOKEN_JSON" "$ACCOUNT"
echo "[token-import] imported and verified $ACCOUNT from EC2"
