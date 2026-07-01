#!/usr/bin/env bash
# Install Cloudflare quick tunnel as a systemd service on EC2 (no custom domain).
# Run ON the instance after the web app is up on :3000.
#
# Usage: sudo bash scripts/ec2-install-tunnel.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash $0"
  exit 1
fi

log() { echo ""; echo "━━ $* ━━"; }

log "Install cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) CF_ARCH=amd64 ;;
    aarch64|arm64) CF_ARCH=arm64 ;;
    *) echo "✗  Unsupported arch: $ARCH"; exit 1 ;;
  esac
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
    -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi
cloudflared --version

log "systemd service: ak-tunnel"
cat > /etc/systemd/system/ak-tunnel.service <<'UNIT'
[Unit]
Description=Cloudflare quick tunnel for AK System
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
Restart=always
RestartSec=5
StandardOutput=append:/var/log/ak-tunnel.log
StandardError=append:/var/log/ak-tunnel.log

[Install]
WantedBy=multi-user.target
UNIT

touch /var/log/ak-tunnel.log
chmod 644 /var/log/ak-tunnel.log
systemctl daemon-reload
systemctl enable ak-tunnel
systemctl restart ak-tunnel

log "Waiting for tunnel URL in /var/log/ak-tunnel.log"
TUNNEL_URL=""
for i in $(seq 1 60); do
  TUNNEL_URL="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /var/log/ak-tunnel.log 2>/dev/null | head -1 || true)"
  if [ -n "$TUNNEL_URL" ]; then
    echo "✓  Tunnel URL: $TUNNEL_URL"
    echo "$TUNNEL_URL" > /opt/ak-system/deploy/tunnel.url 2>/dev/null || echo "$TUNNEL_URL" > /tmp/ak-tunnel.url
    break
  fi
  sleep 2
done

if [ -z "$TUNNEL_URL" ]; then
  echo "⚠  URL not found yet. Check: journalctl -u ak-tunnel -f"
  echo "   Or: grep trycloudflare /var/log/ak-tunnel.log"
  exit 0
fi

echo ""
echo "Next on the instance:"
echo "  cd /opt/ak-system && bash scripts/ec2-sync-tunnel-url.sh"
