#!/usr/bin/env bash
# One-time provisioning for a fresh AWS EC2 Free Tier instance (Ubuntu 22.04+).
# Run ON the instance (via SSH), once:
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/scripts/ec2-bootstrap.sh | bash
# or copy the repo over and run:  bash scripts/ec2-bootstrap.sh
#
# Installs Docker + Compose plugin, a 2 GB swap file (survives `next build` on 1 GB RAM),
# and prepares /opt/ak-system. Idempotent — safe to re-run.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ak-system}"
REPO_URL="${REPO_URL:-}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

log() { echo ""; echo "━━ $* ━━"; }

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

log "System update"
$SUDO apt-get update -y
$SUDO apt-get upgrade -y

log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  $SUDO apt-get install -y ca-certificates curl gnupg git
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO usermod -aG docker "${SUDO_USER:-$USER}" || true
  echo "✓  Docker installed (log out/in for the docker group to take effect)"
else
  echo "✓  Docker already installed"
fi

log "Swap (${SWAP_SIZE})"
if ! swapon --show | grep -q '/swapfile'; then
  $SUDO fallocate -l "$SWAP_SIZE" /swapfile || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile
  $SUDO swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
  fi
  echo "✓  Swap enabled"
else
  echo "✓  Swap already present"
fi

log "App directory: $APP_DIR"
$SUDO mkdir -p "$APP_DIR"
$SUDO chown "${SUDO_USER:-$USER}":"${SUDO_USER:-$USER}" "$APP_DIR"

if [ -n "$REPO_URL" ] && [ ! -d "$APP_DIR/.git" ]; then
  log "Cloning repo"
  git clone "$REPO_URL" "$APP_DIR"
fi

log "Done"
cat <<EOF

Next steps:
  1. Ensure the code is in $APP_DIR (git clone, or 'pnpm deploy:ec2' from your Mac rsyncs it).
  2. Put your filled deploy/production.env in $APP_DIR/deploy/production.env.
  3. From your Mac: configure deploy/ec2.env, then run 'pnpm deploy:ec2'.
  4. Set up HTTPS (Caddy or Cloudflare Tunnel) — see docs/deploy/ec2-production.md.
  5. Install cron: bash scripts/install-server-cron.sh
EOF
