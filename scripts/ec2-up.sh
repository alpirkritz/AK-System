#!/usr/bin/env bash
# End-to-end: provision EC2 (if needed) → bootstrap → deploy → Cloudflare tunnel → cron.
#
# Prerequisites:
#   - AWS CLI configured: aws configure  OR  aws login
#   - apps/web/.env.local filled with secrets
#
# Usage: bash scripts/ec2-up.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

EC2_ENV="$ROOT_DIR/deploy/ec2.env"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"

log() { echo ""; echo "━━ $* ━━"; }

# ── 0. Preconditions ──────────────────────────────────────────────────────────
if [ ! -f "$WEB_ENV" ]; then
  echo "✗  Missing $WEB_ENV — copy from apps/web/.env.local.example and fill secrets."
  exit 1
fi

# ── 1. Provision EC2 if deploy/ec2.env missing ────────────────────────────────
if [ ! -f "$EC2_ENV" ]; then
  log "Provision EC2 (deploy/ec2.env not found)"
  bash "$SCRIPT_DIR/aws-provision-ec2.sh"
fi

set -a
# shellcheck disable=SC1090
source "$EC2_ENV"
set +a
: "${DEPLOY_HOST:?DEPLOY_HOST missing in deploy/ec2.env}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")
REMOTE="${DEPLOY_USER:-ubuntu}@${DEPLOY_HOST}"
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

# ── 2. Production env (placeholder URL; updated after tunnel) ─────────────────
if [ ! -f "$ROOT_DIR/deploy/production.env" ]; then
  log "Generate deploy/production.env"
  bash "$SCRIPT_DIR/generate-production-env.sh" "http://127.0.0.1:3000"
fi

# ── 3. Bootstrap on server (idempotent) ───────────────────────────────────────
log "Bootstrap on $REMOTE"
ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo mkdir -p /opt/ak-system && sudo chown \$(whoami):\$(whoami) /opt/ak-system"
rsync -az -e "$RSYNC_SSH" "$SCRIPT_DIR/ec2-bootstrap.sh" "${REMOTE}:/tmp/ec2-bootstrap.sh"
ssh "${SSH_OPTS[@]}" "$REMOTE" "bash /tmp/ec2-bootstrap.sh" || true
# docker group may need re-login; use sudo for docker on first run
ssh "${SSH_OPTS[@]}" "$REMOTE" "groups | grep -q docker || echo 'note: docker group — using sudo for compose'"

# ── 4. Deploy app ─────────────────────────────────────────────────────────────
log "Deploy application"
SKIP_CI=1 bash "$SCRIPT_DIR/deploy-ec2.sh"

# ── 5. Cloudflare tunnel (HTTPS without domain) ───────────────────────────────
log "Install Cloudflare tunnel on server"
rsync -az -e "$RSYNC_SSH" \
  "$SCRIPT_DIR/ec2-install-tunnel.sh" \
  "$SCRIPT_DIR/ec2-sync-tunnel-url.sh" \
  "${REMOTE}:/opt/ak-system/scripts/"
ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo bash /opt/ak-system/scripts/ec2-install-tunnel.sh"

log "Sync tunnel URL → production.env + restart web"
ssh "${SSH_OPTS[@]}" "$REMOTE" "cd /opt/ak-system && bash scripts/ec2-sync-tunnel-url.sh && (docker compose -f deploy/docker-compose.production.yml up -d || sudo docker compose -f deploy/docker-compose.production.yml up -d)"

# ── 6. Cron on server ───────────────────────────────────────────────────────────
log "Install server cron"
ssh "${SSH_OPTS[@]}" "$REMOTE" "cd /opt/ak-system && bash scripts/install-server-cron.sh" || echo "⚠  cron install skipped (check CRON_SECRET)"

# ── 7. Show tunnel URL ────────────────────────────────────────────────────────
TUNNEL_URL="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /var/log/ak-tunnel.log 2>/dev/null | head -1" || true)"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓  AK System is up on EC2"
echo "   SSH:     ssh -i ${SSH_KEY:-~/.ssh/ak-system.pem} ubuntu@${DEPLOY_HOST}"
[ -n "$TUNNEL_URL" ] && echo "   App URL: $TUNNEL_URL"
echo ""
echo "   One-time: add Google OAuth redirect URI:"
[ -n "$TUNNEL_URL" ] && echo "     ${TUNNEL_URL}/api/auth/callback/google"
echo ""
echo "   Logs:    ssh ... 'cd /opt/ak-system && docker compose -f deploy/docker-compose.production.yml logs -f web'"
echo "   Tunnel:  ssh ... 'sudo journalctl -u ak-tunnel -f'"
echo "════════════════════════════════════════════════════════════"
