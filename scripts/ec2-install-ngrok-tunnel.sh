#!/usr/bin/env bash
# Install the ngrok static-domain tunnel as a systemd service ON the EC2 instance.
#
# Replaces the Cloudflare quick tunnel (scripts/ec2-install-tunnel.sh), whose
# *.trycloudflare.com hostname is regenerated on every restart — a moving URL breaks
# the baked-in EXPO_PUBLIC_API_URL in the Helm APK and invalidates Web Push
# subscriptions. The ngrok free static domain is permanent.
#
# The ngrok free plan permits a single online agent per account, so the tunnel must
# run either here or on the Mac — never both. This script is the "here" side.
#
# Usage (on the instance):
#   sudo NGROK_AUTHTOKEN=<token> NGROK_STATIC_DOMAIN=<name>.ngrok-free.dev \
#     bash scripts/ec2-install-ngrok-tunnel.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash $0"
  exit 1
fi

: "${NGROK_AUTHTOKEN:?NGROK_AUTHTOKEN is required}"
: "${NGROK_STATIC_DOMAIN:?NGROK_STATIC_DOMAIN is required (e.g. your-name.ngrok-free.dev)}"

PORT="${WEB_PORT:-3000}"
CONFIG_DIR=/etc/ngrok
CONFIG_FILE="$CONFIG_DIR/ngrok.yml"

log() { echo ""; echo "━━ $* ━━"; }

log "Install ngrok"
if ! command -v ngrok >/dev/null 2>&1; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) NG_ARCH=amd64 ;;
    aarch64|arm64) NG_ARCH=arm64 ;;
    *) echo "✗  Unsupported arch: $ARCH"; exit 1 ;;
  esac
  TMP="$(mktemp -d)"
  curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${NG_ARCH}.tgz" \
    -o "$TMP/ngrok.tgz"
  tar -xzf "$TMP/ngrok.tgz" -C /usr/local/bin ngrok
  chmod +x /usr/local/bin/ngrok
  rm -rf "$TMP"
fi
ngrok version

log "Write agent config"
# Let the binary author the file so the schema matches the installed major version.
mkdir -p "$CONFIG_DIR"
rm -f "$CONFIG_FILE"
ngrok config add-authtoken "$NGROK_AUTHTOKEN" --config "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

log "systemd service: ak-ngrok"
cat > /etc/systemd/system/ak-ngrok.service <<UNIT
[Unit]
Description=ngrok static-domain tunnel for AK System
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
# --host-header pins the upstream Host to the public domain. Left at the default,
# ngrok forwards Host: localhost:3000, which makes middleware.ts treat every request
# as local and build auth callbackUrls pointing at localhost.
ExecStart=/usr/local/bin/ngrok http ${PORT} --url=https://${NGROK_STATIC_DOMAIN} --host-header=${NGROK_STATIC_DOMAIN} --log=stdout --log-format=logfmt --config ${CONFIG_FILE}
Restart=always
RestartSec=10
StandardOutput=append:/var/log/ak-ngrok.log
StandardError=append:/var/log/ak-ngrok.log

[Install]
WantedBy=multi-user.target
UNIT

touch /var/log/ak-ngrok.log
chmod 644 /var/log/ak-ngrok.log
systemctl daemon-reload
systemctl enable ak-ngrok
systemctl restart ak-ngrok

log "Retire the Cloudflare quick tunnel"
# Two tunnels onto :3000 would give the app two competing public origins, and only
# the ngrok one is stable enough to hard-code into clients.
if systemctl list-unit-files | grep -q '^ak-tunnel.service'; then
  systemctl disable --now ak-tunnel || true
  echo "   ak-tunnel stopped and disabled"
else
  echo "   ak-tunnel not installed — nothing to do"
fi

log "Wait for the tunnel to come online"
ONLINE=0
for _ in $(seq 1 30); do
  if curl -sf --max-time 3 http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | grep -q "${NGROK_STATIC_DOMAIN}"; then
    ONLINE=1
    break
  fi
  sleep 2
done

if [ "$ONLINE" -ne 1 ]; then
  echo "✗  Tunnel did not come online. Check: journalctl -u ak-ngrok -n 50"
  echo "   A 'session limit' error means another ngrok agent (likely the Mac) is still connected."
  exit 1
fi

echo "https://${NGROK_STATIC_DOMAIN}" > /opt/ak-system/deploy/tunnel.url 2>/dev/null || true

echo ""
echo "✓  Tunnel online: https://${NGROK_STATIC_DOMAIN}"
echo ""
echo "Next on the instance:"
echo "  cd /opt/ak-system && bash scripts/ec2-sync-tunnel-url.sh https://${NGROK_STATIC_DOMAIN}"
echo "  docker compose -f deploy/docker-compose.production.yml --profile whatsapp up -d"
