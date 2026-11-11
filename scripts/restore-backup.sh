#!/usr/bin/env bash
# Restore an AK System backup archive (run ON the EC2 host, as a user with docker + sudo).
#
#   bash scripts/restore-backup.sh <archive.tar.gz.age> --key <age-private-key-file> [--files] [--yes]
#
# 1. decrypts with the owner's PRIVATE key (copy it to the box only for the restore, then delete it)
# 2. verifies PRAGMA integrity_check of the contained database
# 3. stops the web container, moves the live DB (+ -wal/-shm) to *.pre-restore, installs the restored DB
# 4. restarts web. --files also restores abc-data and bridge-config (old copies kept as *.pre-restore).
# The WhatsApp bridge-auth volume is never in a backup: re-pair via QR after a full restore.
#
# A remote archive can be fetched first:
#   RCLONE_CONFIG=/opt/ak-system/rclone.conf rclone copy akdrive:AK_system_backups/ak_system-YYYY-MM-DD.tar.gz.age .
#
# Testing hook: RESTORE_TARGET_DIR=<dir> restores into a plain directory, no docker.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/backup-common.sh"

ARCHIVE=""; KEY=""; FILES=0; YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="$2"; shift ;;
    --files) FILES=1 ;;
    --yes) YES=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) ARCHIVE="$1" ;;
  esac
  shift
done
[ -f "$ARCHIVE" ] || { echo "usage: $0 <archive.tar.gz.age> --key <private-key> [--files] [--yes]" >&2; exit 2; }
[ -f "$KEY" ] || { echo "age private key not found: ${KEY:-<none>} (pass --key)" >&2; exit 2; }
need age; need sqlite3; need tar

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.production.yml}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ak-restore.XXXXXX")"
trap '[ -d "$TMP" ] && rm -rf "${TMP:?}"' EXIT

echo "→ decrypting $ARCHIVE"
age -d -i "$KEY" "$ARCHIVE" | tar -xzf - -C "$TMP"
[ -f "$TMP/$DB_NAME" ] || { echo "archive does not contain $DB_NAME" >&2; exit 1; }
[ "$(sqlite3 -readonly "$TMP/$DB_NAME" 'PRAGMA integrity_check')" = ok ] || { echo "✗ integrity_check failed - aborting, live DB untouched" >&2; exit 1; }
echo "✓ integrity_check ok. Row counts in the backup:"
row_counts "$TMP/$DB_NAME" | sed 's/^/    /'

if [ -n "${RESTORE_TARGET_DIR:-}" ]; then
  WEB_DATA="$RESTORE_TARGET_DIR"; ABC_DATA="$RESTORE_TARGET_DIR/abc-data"; BRIDGE_CFG="$RESTORE_TARGET_DIR/bridge-config"
  DOCKER=0
else
  WEB_DATA="$(volume_dir web-data)"; ABC_DATA="$(volume_dir abc-data)"; BRIDGE_CFG="$(volume_dir bridge-config)"
  DOCKER=1
fi

if [ "$YES" != 1 ]; then
  read -r -p "Replace the live database in $WEB_DATA with this backup? (old one kept as .pre-restore) [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "aborted"; exit 1; }
fi

if [ "$DOCKER" = 1 ]; then
  echo "→ stopping web"
  (cd "$DEPLOY_PATH" && as_root docker compose -f "$COMPOSE_FILE" stop web)
fi

SUFFIX=".pre-restore"
OWNER="$(as_root stat -c '%u:%g' "$WEB_DATA" 2>/dev/null || stat -f '%u:%g' "$WEB_DATA")"
for ext in "" "-wal" "-shm"; do
  if as_root test -e "$WEB_DATA/$DB_NAME$ext"; then
    as_root rm -rf "${WEB_DATA:?}/${DB_NAME}${ext}${SUFFIX}"
    as_root mv "$WEB_DATA/$DB_NAME$ext" "$WEB_DATA/$DB_NAME$ext$SUFFIX"
  fi
done
as_root cp "$TMP/$DB_NAME" "$WEB_DATA/$DB_NAME"
as_root chown "$OWNER" "$WEB_DATA/$DB_NAME"
echo "✓ database restored (previous kept as $WEB_DATA/$DB_NAME$SUFFIX)"

if [ "$FILES" = 1 ]; then
  for pair in "abc-data:$ABC_DATA" "bridge-config:$BRIDGE_CFG"; do
    src="$TMP/${pair%%:*}"; dst="${pair#*:}"
    [ -d "$src" ] || continue
    as_root mkdir -p "$dst"
    as_root rm -rf "${dst:?}${SUFFIX}"
    as_root cp -a "$dst" "${dst}${SUFFIX}"
    as_root cp -a "$src/." "$dst/"
    echo "✓ restored ${pair%%:*} (previous kept as ${dst}${SUFFIX})"
  done
fi

if [ "$DOCKER" = 1 ]; then
  echo "→ starting web"
  (cd "$DEPLOY_PATH" && as_root docker compose -f "$COMPOSE_FILE" up -d web)
  sleep 8
  curl -sf -o /dev/null --max-time 20 http://127.0.0.1:3000 && echo "✓ web responding" || echo "⚠ web not responding yet - check: docker compose -f $COMPOSE_FILE logs web"
fi
echo "Done. Roll back with: mv $DB_NAME$SUFFIX back over $DB_NAME (stop web first)."
