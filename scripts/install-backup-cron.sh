#!/usr/bin/env bash
# Install the backup cron jobs on the EC2 instance. Run ON the instance, after the one-time
# setup in docs/deploy/backup-and-restore.md (age/rclone/sqlite3 installed, backup.age.pub and
# rclone.conf in place). Appends a managed block to the current user's crontab, so it coexists
# with install-server-cron.sh (which owns the rest of the crontab and must run FIRST: it
# replaces the whole crontab; deploy-ec2.sh runs them in that order).
#
#   cd /opt/ak-system && bash scripts/install-backup-cron.sh
#
# Schedule (UTC):  01:00 backup-daily   01:30 backup-audio   02:00 on the 1st audio-cleanup
# Weekly EBS snapshot is NOT a cron job here - use AWS DLM (see docs/deploy/backup-and-restore.md).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/production.env"
LOG_DIR="${BACKUP_LOG_DIR:-/var/log/ak-backup}"
BEGIN="# >>> ak-backup (managed by scripts/install-backup-cron.sh) >>>"
END="# <<< ak-backup <<<"

[ -f "$ENV_FILE" ] || { echo "✗  Missing $ENV_FILE"; exit 1; }
for f in "$ROOT_DIR/backup.age.pub" "$ROOT_DIR/rclone.conf"; do
  [ -f "$f" ] || { echo "✗  Missing $f - complete docs/deploy/backup-and-restore.md first"; exit 1; }
done
for c in age rclone sqlite3 flock; do
  command -v "$c" >/dev/null 2>&1 || { echo "✗  '$c' not installed (sudo apt install ... see docs)"; exit 1; }
done
sudo mkdir -p /opt/ak-backups "$LOG_DIR"
sudo chown "$(whoami):$(whoami)" /opt/ak-backups "$LOG_DIR"
chmod 600 "$ROOT_DIR/rclone.conf" 2>/dev/null || true
chmod +x "$SCRIPT_DIR"/backup-daily.sh "$SCRIPT_DIR"/backup-audio.sh "$SCRIPT_DIR"/audio-cleanup-monthly.sh

APP_URL="${APP_URL:-http://127.0.0.1:3000}"
CRON_SECRET="$(grep -E '^CRON_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'" || true)"
BLOCK="$BEGIN
SHELL=/bin/bash
0 1 * * * APP_URL=$APP_URL bash $ROOT_DIR/scripts/backup-daily.sh >> $LOG_DIR/daily.log 2>&1
30 1 * * * APP_URL=$APP_URL bash $ROOT_DIR/scripts/backup-audio.sh >> $LOG_DIR/audio.log 2>&1
0 2 1 * * APP_URL=$APP_URL bash $ROOT_DIR/scripts/audio-cleanup-monthly.sh >> $LOG_DIR/audio-cleanup.log 2>&1
15 * * * * curl -fsS -m 30 -H \"Authorization: Bearer $CRON_SECRET\" $APP_URL/api/cron/backup-report >> $LOG_DIR/deadman.log 2>&1
$END"

CURRENT="$(crontab -l 2>/dev/null || true)"
# Drop a previous managed block, then append the fresh one.
STRIPPED="$(printf '%s\n' "$CURRENT" | awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}')"
printf '%s\n%s\n' "$STRIPPED" "$BLOCK" | crontab -

echo "✓  Backup cron installed (daily 01:00, audio 01:30, audio cleanup 1st 02:00 UTC). Verify: crontab -l"
echo "   Logs: $LOG_DIR/   Passwordless sudo is required for docker volume access (default on Ubuntu EC2)."
echo "   Reminder: weekly EBS snapshots via AWS DLM (keep 4) - docs/deploy/backup-and-restore.md"
