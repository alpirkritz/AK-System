#!/usr/bin/env bash
# Deploy AK System to an EC2 instance from your Mac — no Railway, no external CI.
#
#   1. Run local CI gate (lint, test, e2e, build)   — skip with SKIP_CI=1
#   2. rsync the repo to the instance               — over SSH
#   3. Copy deploy/production.env to the instance
#   4. docker compose up -d --build (web by default)
#   5. Health check
#
# Config: deploy/ec2.env (copy from deploy/ec2.env.example).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

EC2_ENV="$ROOT_DIR/deploy/ec2.env"
if [ ! -f "$EC2_ENV" ]; then
  echo "✗  Missing $EC2_ENV. Copy from deploy/ec2.env.example and fill in."
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

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

step() { echo ""; echo "━━ $* ━━"; }

# ── 0. SSH access (IP may have changed since last provision) ─────────────────
if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
  step "Ensure SSH access from this IP"
  bash "$SCRIPT_DIR/ec2-ensure-ssh-access.sh"
fi

# ── 1. Local CI gate ──────────────────────────────────────────────────────────
if [ "${SKIP_CI:-0}" != "1" ]; then
  step "Local CI (set SKIP_CI=1 to skip)"
  bash "$SCRIPT_DIR/ci.sh"
elif [ "${SKIP_LOCAL_BUILD:-0}" != "1" ]; then
  step "Local production build (EC2 is too small to run next build)"
  if [ -f "$ROOT_DIR/deploy/production.env" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_DIR/deploy/production.env"
    set +a
    echo "→ Building with NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-unset}"
    # ABC_ROOT=/app is for the container only — unset so Next.js build does not bake
    # empty /api/agents static output when /app/A_Agents is missing on the Mac.
    unset ABC_ROOT
  fi
  AK_DEPLOY_BUILD=1 pnpm build
fi

if [ "${SKIP_LOCAL_BUILD:-0}" != "1" ] && [ ! -d "$ROOT_DIR/apps/web/.next" ]; then
  echo "✗  apps/web/.next missing — run pnpm build on Mac first"
  exit 1
fi

# ── 2. Sync code ──────────────────────────────────────────────────────────────
step "Sync code → ${REMOTE}:${DEPLOY_PATH}"
ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo mkdir -p '$DEPLOY_PATH' && sudo chown \$(whoami):\$(whoami) '$DEPLOY_PATH'"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'data' \
  --exclude '*.sqlite' \
  --exclude '.turbo' \
  --exclude 'deploy/ec2.env' \
  -e "ssh ${SSH_OPTS[*]}" \
  "$ROOT_DIR/" "${REMOTE}:${DEPLOY_PATH}/"

# ── 3. Production env ─────────────────────────────────────────────────────────
if [ -f "$ROOT_DIR/deploy/production.env" ]; then
  step "Copy deploy/production.env"
  scp "${SSH_OPTS[@]}" "$ROOT_DIR/deploy/production.env" "${REMOTE}:${DEPLOY_PATH}/deploy/production.env"
else
  echo "⚠  deploy/production.env not found locally — assuming it already exists on the server."
fi

# Keep WhatsApp bridge webhook aligned with the public app URL (tunnel may have changed).
if [ -f "$ROOT_DIR/deploy/whatsapp-bridge.env" ]; then
  step "Sync WhatsApp bridge webhook URL"
  bash "$SCRIPT_DIR/sync-bridge-webhook-url.sh"
  scp "${SSH_OPTS[@]}" "$ROOT_DIR/deploy/whatsapp-bridge.env" "${REMOTE}:${DEPLOY_PATH}/deploy/whatsapp-bridge.env"
fi

# ── 4. Build + start ──────────────────────────────────────────────────────────
step "docker compose up -d --build"
COMPOSE_PROFILES=""
if [ -f "$ROOT_DIR/deploy/whatsapp-bridge.env" ] || [ "${ENABLE_WHATSAPP:-0}" = "1" ]; then
  COMPOSE_PROFILES="--profile whatsapp"
  echo "→ Including WhatsApp bridge profile"
fi
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "cd '$DEPLOY_PATH' && (docker compose -f '$COMPOSE_FILE' $COMPOSE_PROFILES up -d --build || sudo docker compose -f '$COMPOSE_FILE' $COMPOSE_PROFILES up -d --build) && (docker compose -f '$COMPOSE_FILE' ps || sudo docker compose -f '$COMPOSE_FILE' ps)"

# ── 5. Health check ───────────────────────────────────────────────────────────
step "Health check"
HEALTH_URL="${APP_URL:-}"
if [ -n "$HEALTH_URL" ] && [[ "$HEALTH_URL" == https://* ]] && [[ "$HEALTH_URL" != *your-domain* ]]; then
  if curl -sf -o /dev/null --max-time 20 "$HEALTH_URL"; then
    echo "✓  $HEALTH_URL responding"
  else
    echo "⚠  $HEALTH_URL not responding yet (proxy/cert may still be warming up)."
  fi
else
  if ssh "${SSH_OPTS[@]}" "$REMOTE" "curl -sf -o /dev/null --max-time 20 http://127.0.0.1:3000"; then
    echo "✓  web responding on the instance (127.0.0.1:3000)"
  else
    echo "⚠  web not responding on 127.0.0.1:3000 yet. Check: docker compose -f $COMPOSE_FILE logs web"
  fi
fi

# ── 6. Server cron (replaces GitHub Actions — see docs/deploy/cron-setup.md) ───
step "Install server cron"
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "cd '$DEPLOY_PATH' && APP_URL=http://127.0.0.1:3000 bash scripts/install-server-cron.sh" \
  || echo "⚠  cron install skipped (check CRON_SECRET in deploy/production.env)"

# ── 7. Re-sync WhatsApp group rules to the bridge ─────────────────────────────
# The bridge holds its watch config in memory + a persisted file; re-push from the
# DB (source of truth) so a fresh container/volume is guaranteed to match. Non-fatal.
if [ -n "$COMPOSE_PROFILES" ]; then
  step "Re-sync WhatsApp group rules → bridge"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "cd '$DEPLOY_PATH' && \
    SECRET=\$(grep '^CRON_SECRET=' deploy/production.env 2>/dev/null | cut -d= -f2- | tr -d '\"') && \
    sleep 10 && \
    curl -sf -X POST -H \"Authorization: Bearer \$SECRET\" http://127.0.0.1:3000/api/whatsapp/sync-bridge && echo ' ✓ synced' || echo '⚠  bridge re-sync deferred (retry from Settings → סנכרן כללים)'" || true
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓  Deploy complete → ${REMOTE}:${DEPLOY_PATH}"
echo "   Logs:   ssh ${REMOTE} 'cd $DEPLOY_PATH && docker compose -f $COMPOSE_FILE logs -f web'"
echo "   Cron:   crontab on instance (localhost:3000) — bash scripts/install-server-cron-remote.sh to refresh"
echo "════════════════════════════════════════════════════════════"
