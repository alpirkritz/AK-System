#!/usr/bin/env bash
# Daily encrypted backup of the AK System state (runs ON the EC2 host, from cron).
#
#   1. sqlite3 VACUUM INTO snapshot of ak_system.sqlite (consistent while the app runs)
#   2. PRAGMA integrity_check + row-count sanity vs the previous snapshot (>20% drop = alert)
#   3. tar abc-data + bridge-config (NOT bridge-auth), gzip, age-encrypt (public key only)
#   4. keep 7 locally in /opt/ak-backups, rclone copy to Drive, prune 14 daily/8 weekly/12 monthly
#   5. report to $APP_URL/api/cron/backup-report (failures too)
#
#   bash scripts/backup-daily.sh              # normal run
#   bash scripts/backup-daily.sh --predeploy  # local-only snapshot before a deploy (no Drive, no report)
#
# Env overrides: DEPLOY_PATH BACKUP_DIR APP_URL RCLONE_REMOTE AGE_PUBKEY_FILE RCLONE_CONFIG
#   FORCE_COUNT_DROP=1 accepts a legitimate >20% row drop.
# Docs: docs/deploy/backup-and-restore.md
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/backup-common.sh"

MODE=daily
[ "${1:-}" = "--predeploy" ] && MODE=predeploy
KIND=db; NO_REPORT=0; FAIL_MSG=""
[ "$MODE" = predeploy ] && { KIND=predeploy; NO_REPORT=1; }
STARTED_AT="$(now_iso)"
install_failure_trap
need sqlite3; need age; need tar; need gzip
if [ "$MODE" = daily ]; then need rclone; need curl; fi
[ -f "$AGE_PUBKEY_FILE" ] || { FAIL_MSG="missing age public key: $AGE_PUBKEY_FILE"; echo "$FAIL_MSG" >&2; exit 1; }
AGE_RECIPIENT="$(grep -v '^#' "$AGE_PUBKEY_FILE" | head -n1 | tr -d '[:space:]')"
case "$AGE_RECIPIENT" in age1*) ;; *) FAIL_MSG="invalid age public key in $AGE_PUBKEY_FILE"; echo "$FAIL_MSG" >&2; exit 1 ;; esac

single_instance "backup-$MODE"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%F)"
PREFIX=ak_system
if [ "$MODE" = predeploy ]; then STAMP="$(date -u +%Y-%m-%d_%H%M%S)"; PREFIX=predeploy; fi
OUT="$BACKUP_DIR/${PREFIX}-${STAMP}.tar.gz.age"
CLEANUP_DIR="$(mktemp -d "$BACKUP_DIR/.stage.XXXXXX")"
STAGE="$CLEANUP_DIR/stage"; mkdir -p "$STAGE"

WEB_DATA="${WEB_DATA_DIR:-$(volume_dir web-data)}"
ABC_DATA="${ABC_DATA_DIR:-$(volume_dir abc-data)}"
BRIDGE_CFG="${BRIDGE_CONFIG_DIR:-$(volume_dir bridge-config)}"
SRC_DB="$WEB_DATA/$DB_NAME"
as_root test -f "$SRC_DB" || { FAIL_MSG="database not found: $SRC_DB"; echo "$FAIL_MSG" >&2; exit 1; }

log "[$MODE] snapshotting $SRC_DB"
FAIL_MSG="sqlite VACUUM INTO failed"
as_root "${LOWPRIO[@]}" sqlite3 "$SRC_DB" "VACUUM INTO '$STAGE/$DB_NAME'"
as_root chown -R "$(id -u):$(id -g)" "$STAGE"

FAIL_MSG="snapshot integrity_check failed"
[ "$(sqlite3 -readonly "$STAGE/$DB_NAME" 'PRAGMA integrity_check')" = ok ]
FAIL_MSG=""

row_counts "$STAGE/$DB_NAME" > "$STAGE/rowcounts.tsv"
PREV_COUNTS="$BACKUP_DIR/.rowcounts.prev"
if [ -f "$PREV_COUNTS" ]; then
  DROPS="$(compare_counts "$PREV_COUNTS" "$STAGE/rowcounts.tsv" || true)"
  if [ -n "$DROPS" ]; then
    log "row count drop >20% vs previous snapshot: $DROPS"
    if [ "${FORCE_COUNT_DROP:-0}" != 1 ]; then
      FAIL_MSG="row count dropped >20% vs previous snapshot: $(echo "$DROPS" | tr '\n' ';') (set FORCE_COUNT_DROP=1 if intended)"
      exit 1
    fi
  fi
fi

# Other volumes (bridge-auth is intentionally excluded).
as_root cp -a "$ABC_DATA" "$STAGE/abc-data" || mkdir -p "$STAGE/abc-data"
as_root cp -a "$BRIDGE_CFG" "$STAGE/bridge-config" || mkdir -p "$STAGE/bridge-config"
as_root chown -R "$(id -u):$(id -g)" "$STAGE"
VOICE_HOST="$(voice_dir_host "$WEB_DATA")"
{
  echo "created_at=$(now_iso)"; echo "host=$(hostname)"; echo "mode=$MODE"
  echo "--- audio files present on host (audio itself is backed up by backup-audio.sh) ---"
  as_root ls -1 "$VOICE_HOST" 2>/dev/null || true
} > "$STAGE/MANIFEST.txt"

log "[$MODE] archive + encrypt -> $OUT"
FAIL_MSG="archive/encrypt failed"
TMP_OUT="$OUT.partial"
tar -C "$STAGE" -cf - . | "${LOWPRIO[@]}" gzip -6 | "${LOWPRIO[@]}" age -r "$AGE_RECIPIENT" > "$TMP_OUT"
mv "$TMP_OUT" "$OUT"
SIZE="$(file_size "$OUT")"
SHA="$(sha256_of "$OUT")"
echo "$SHA  $(basename "$OUT")" > "$OUT.sha256"
cp "$STAGE/rowcounts.tsv" "$PREV_COUNTS"
FAIL_MSG=""

# Local retention: 7 daily archives (3 pre-deploy snapshots).
KEEP=7; [ "$MODE" = predeploy ] && KEEP=3
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR/${PREFIX}-"*.tar.gz.age 2>/dev/null | tail -n +"$((KEEP+1))" | while read -r f; do
  rm -f "${f:?}" "${f:?}.sha256"
done

if [ "$MODE" = predeploy ]; then
  log "pre-deploy snapshot ok: $OUT ($SIZE bytes)"; REPORT_DONE=1; exit 0
fi

FAIL_MSG="rclone upload failed"
log "uploading to $RCLONE_REMOTE"
"${LOWPRIO[@]}" rclone copy "$OUT" "$RCLONE_REMOTE/" --checksum --transfers 1 --checkers 2 --buffer-size 4M --retries 3
"${LOWPRIO[@]}" rclone copy "$OUT.sha256" "$RCLONE_REMOTE/" --transfers 1
FILE_ID="$(rclone lsjson "$RCLONE_REMOTE/$(basename "$OUT")" --no-modtime --no-mimetype 2>/dev/null | grep -o '"ID":"[^"]*"' | head -n1 | cut -d'"' -f4 || true)"
[ -n "$FILE_ID" ] || { FAIL_MSG="uploaded file not found on Drive afterwards"; exit 1; }

FAIL_MSG="Drive prune failed"
rclone lsf "$RCLONE_REMOTE/" --files-only | grep -E '^ak_system-[0-9]{4}-[0-9]{2}-[0-9]{2}\.tar\.gz\.age$' \
  | prune_candidates 14 8 12 | while read -r old; do
    log "pruning $old from Drive"
    rclone deletefile "$RCLONE_REMOTE/$old"
    rclone deletefile "$RCLONE_REMOTE/$old.sha256" 2>/dev/null || true
  done
FAIL_MSG=""

log "backup ok: $OUT ($SIZE bytes, sha256 $SHA, drive id $FILE_ID)"
report_to_app db ok "$STARTED_AT" "$(now_iso)" "$SIZE" "$SHA" "$FILE_ID" ""
REPORT_DONE=1
