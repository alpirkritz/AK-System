#!/usr/bin/env bash
# Install a Cloudflare **Named Tunnel** on EC2 for a stable HTTPS URL.
# Requires: deploy/cloudflare.env with CLOUDFLARE_TUNNEL_TOKEN and APP_URL.
# Public hostname must already be configured in Cloudflare Zero Trust dashboard.
#
# Usage (from Mac): bash scripts/ec2-setup-named-tunnel.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CF_ENV="$ROOT_DIR/deploy/cloudflare.env"
EC2_ENV="$ROOT_DIR/deploy/ec2.env"

log() { echo ""; echo "━━ $* ━━"; }

if [ ! -f "$CF_ENV" ]; then
  echo "✗  Missing $CF_ENV"
  echo "   cp deploy/cloudflare.env.example deploy/cloudflare.env"
  echo "   See docs/deploy/cloudflare-stable-url.md"
  exit 1
fi
if [ ! -f "$EC2_ENV" ]; then
  echo "✗  Missing $EC2_ENV — run pnpm ec2:up first or copy deploy/ec2.env.example"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$CF_ENV"
source "$EC2_ENV"
set +a

: "${CLOUDFLARE_TUNNEL_TOKEN:?set CLOUDFLARE_TUNNEL_TOKEN in deploy/cloudflare.env}"
: "${APP_URL:?set APP_URL in deploy/cloudflare.env (your stable https://ak.yourdomain.com)}"
APP_URL="${APP_URL%/}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")
REMOTE="${DEPLOY_USER:-ubuntu}@${DEPLOY_HOST}"
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

log "Install named tunnel on $REMOTE"
log "Stable URL: $APP_URL"

# Stop quick-tunnel service if present (replaced by named tunnel)
ssh "${SSH_OPTS[@]}" "$REMOTE" 'sudo systemctl stop ak-tunnel 2>/dev/null || true; sudo systemctl disable ak-tunnel 2>/dev/null || true'

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<REMOTE_SCRIPT
set -euo pipefail
if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" \
    -o /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/cloudflared && sudo chmod +x /usr/local/bin/cloudflared
fi
sudo cloudflared service uninstall 2>/dev/null || true
sudo cloudflared service install "${CLOUDFLARE_TUNNEL_TOKEN}"
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared
sudo systemctl is-active cloudflared
REMOTE_SCRIPT

log "Update production.env → $APP_URL"
# Update local production.env
for f in "$ROOT_DIR/deploy/production.env"; do
  if [ -f "$f" ]; then
    if grep -q '^NEXT_PUBLIC_APP_URL=' "$f"; then
      sed -i '' "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=${APP_URL}|" "$f" 2>/dev/null || \
        sed -i "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=${APP_URL}|" "$f"
    else
      echo "NEXT_PUBLIC_APP_URL=${APP_URL}" >> "$f"
    fi
    if grep -q '^NEXTAUTH_URL=' "$f"; then
      sed -i '' "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=${APP_URL}|" "$f" 2>/dev/null || \
        sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=${APP_URL}|" "$f"
    else
      echo "NEXTAUTH_URL=${APP_URL}" >> "$f"
    fi
  fi
done

scp "${SSH_OPTS[@]}" "$ROOT_DIR/deploy/production.env" "${REMOTE}:${DEPLOY_PATH:-/opt/ak-system}/deploy/production.env"

log "Rebuild + redeploy app (NEXT_PUBLIC_APP_URL baked into build)"
export APP_URL
set -a && source "$ROOT_DIR/deploy/production.env" && set +a
SKIP_CI=1 bash "$SCRIPT_DIR/deploy-ec2.sh"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓  Named tunnel active"
echo "   App URL:  $APP_URL"
echo "   Google OAuth redirect URI:"
echo "     ${APP_URL}/api/auth/callback/google"
echo "════════════════════════════════════════════════════════════"
