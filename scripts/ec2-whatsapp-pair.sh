#!/usr/bin/env bash
# SSH tunnel to EC2 WhatsApp bridge QR page (port 3001 is not on Cloudflare tunnel).
# Usage: pnpm ec2:whatsapp:pair
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EC2_ENV="$ROOT_DIR/deploy/ec2.env"

if [ ! -f "$EC2_ENV" ]; then
  echo "✗  Missing deploy/ec2.env"
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$EC2_ENV"
set +a

: "${DEPLOY_HOST:?}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/ak-system.pem}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -N -L 3001:127.0.0.1:3001)
[ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")

echo "→ SSH tunnel: localhost:3001 → ${DEPLOY_HOST}:3001"
echo "  Open http://localhost:3001 and scan QR with WhatsApp → Linked devices"
echo "  Ctrl-C to close tunnel"
echo ""

# Open browser on Mac if possible
if command -v open >/dev/null 2>&1; then
  (sleep 2 && open "http://localhost:3001") &
fi

exec ssh "${SSH_OPTS[@]}" "${DEPLOY_USER:-ubuntu}@${DEPLOY_HOST}"
