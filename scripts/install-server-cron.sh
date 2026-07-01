#!/usr/bin/env bash
# Install the AK System cron jobs on the EC2 instance (replaces GitHub Actions cron).
# Reads CRON_SECRET from deploy/production.env and installs deploy/crontab.example
# for the current user, targeting the local web app.
#
# Run ON the instance:  cd /opt/ak-system && bash scripts/install-server-cron.sh
#
# Override the target URL (default http://127.0.0.1:3000):
#   APP_URL=http://127.0.0.1:3000 bash scripts/install-server-cron.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/production.env"
TEMPLATE="$ROOT_DIR/deploy/crontab.example"

[ -f "$ENV_FILE" ] || { echo "✗  Missing $ENV_FILE"; exit 1; }
[ -f "$TEMPLATE" ] || { echo "✗  Missing $TEMPLATE"; exit 1; }

CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
if [ -z "$CRON_SECRET" ]; then
  echo "✗  CRON_SECRET is empty in $ENV_FILE — set it before installing cron."
  exit 1
fi

APP_URL="${APP_URL:-http://127.0.0.1:3000}"
APP_URL="${APP_URL%/}"

GENERATED="$(sed -e "s|__CRON_SECRET__|${CRON_SECRET}|g" -e "s|__APP_URL__|${APP_URL}|g" "$TEMPLATE")"

echo "→ Installing crontab for $(whoami) (target: $APP_URL)"
printf '%s\n' "$GENERATED" | crontab -

echo "✓  Cron installed. Verify with: crontab -l"
echo "   Logs: grep CRON /var/log/syslog   (or journalctl -u cron)"
