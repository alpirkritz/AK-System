#!/usr/bin/env bash
# Install AK System cron on the EC2 instance over SSH.
# Uses deploy/ec2.env for connection and deploy/production.env on the server.
#
# Usage: bash scripts/install-server-cron-remote.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EC2_ENV="$ROOT_DIR/deploy/ec2.env"

[ -f "$EC2_ENV" ] || { echo "✗  Missing $EC2_ENV"; exit 1; }

set -a
# shellcheck disable=SC1090
source "$EC2_ENV"
set +a

: "${DEPLOY_HOST:?set DEPLOY_HOST in deploy/ec2.env}"
: "${DEPLOY_USER:=ubuntu}"
: "${DEPLOY_PATH:=/opt/ak-system}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

echo "→ Sync cron files → ${REMOTE}:${DEPLOY_PATH}"
rsync -az \
  -e "ssh ${SSH_OPTS[*]}" \
  "$ROOT_DIR/deploy/crontab.example" \
  "$ROOT_DIR/scripts/install-server-cron.sh" \
  "${REMOTE}:${DEPLOY_PATH}/"

if [ -f "$ROOT_DIR/deploy/production.env" ]; then
  scp "${SSH_OPTS[@]}" "$ROOT_DIR/deploy/production.env" "${REMOTE}:${DEPLOY_PATH}/deploy/production.env"
fi

echo "→ Install crontab on ${REMOTE}"
ssh "${SSH_OPTS[@]}" "$REMOTE" "cd '$DEPLOY_PATH' && APP_URL=http://127.0.0.1:3000 bash scripts/install-server-cron.sh"

echo "→ Verify"
ssh "${SSH_OPTS[@]}" "$REMOTE" "crontab -l | grep -E 'calendar-sync|whatsapp-group-summary|agent-triggers'"

echo "✓  Server cron installed on ${DEPLOY_HOST}"
