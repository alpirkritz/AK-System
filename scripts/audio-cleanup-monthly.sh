#!/usr/bin/env bash
# Monthly audio cleanup (cron on the 1st). Deletes recordings older than 30 days from BOTH the
# EC2 voice dir and Drive (AK_system_backups/audio/), but ONLY when the analysis is complete:
#   voice_recordings.status = 'completed' AND diarization_status <> 'pending'
#   AND voice_recordings.analysis_id -> meeting_analyses.status = 'completed'
# Anything else is never deleted. Transcripts, analyses and the DB are untouched; the
# voice_recordings.audio_path column is intentionally left as-is (it will point at a missing file).
#
#   bash scripts/audio-cleanup-monthly.sh [--dry-run] [--days N]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/backup-common.sh"
DRY=0; DAYS=30
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --days) DAYS="$2"; shift ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
  shift
done
KIND=audio_cleanup; STARTED_AT="$(now_iso)"; NO_REPORT=$DRY; FAIL_MSG=""
install_failure_trap
need sqlite3
if [ "$DRY" != 1 ]; then need rclone; need curl; fi
single_instance audio-cleanup
MANIFEST="$BACKUP_DIR/audio-manifest.tsv"

WEB_DATA="${WEB_DATA_DIR:-$(volume_dir web-data)}"
DB="$WEB_DATA/$DB_NAME"
VOICE="${VOICE_DIR:-$(voice_dir_host "$WEB_DATA")}"
CUTOFF="$(date -u -d "$DAYS days ago" +%FT%TZ 2>/dev/null || date -u -v-"${DAYS}"d +%FT%TZ)"
log "cutoff: recordings created before $CUTOFF (dry-run=$DRY)"

# created_at is ISO text, so a string comparison is a date comparison.
ROWS="$(as_root sqlite3 -readonly -separator $'\t' "$DB" "
  SELECT v.id, v.audio_path FROM voice_recordings v
  JOIN meeting_analyses a ON a.id = v.analysis_id
  WHERE v.status = 'completed' AND v.diarization_status <> 'pending'
    AND a.status = 'completed' AND v.created_at < '$CUTOFF';")"
TOTAL="$(as_root sqlite3 -readonly "$DB" "SELECT count(*) FROM voice_recordings WHERE created_at < '$CUTOFF';")"
ELIGIBLE="$(printf '%s' "$ROWS" | grep -c . || true)"

DEL=0; FREED=0; MISSING=0
FAIL_MSG="audio cleanup failed"
while IFS=$'\t' read -r id apath; do
  [ -n "${id:-}" ] || continue
  name="$(basename "$apath")"
  [ -n "$name" ] || continue
  local_f="$VOICE/$name"
  if as_root test -f "$local_f"; then
    size="$(root_file_size "$local_f")"
    if [ "$DRY" = 1 ]; then
      log "[dry-run] would delete $name ($size bytes) from EC2 and Drive"
    else
      as_root rm -f "${local_f:?}"
    fi
    DEL=$((DEL+1)); FREED=$((FREED+size))
  else
    MISSING=$((MISSING+1))
  fi
  if [ "$DRY" != 1 ]; then
    rclone deletefile "$RCLONE_REMOTE/audio/$name.age" 2>/dev/null || true
    if [ -f "$MANIFEST" ]; then
      { grep -vF "$(printf '%s\t' "$name")" "$MANIFEST" || true; } > "$MANIFEST.tmp"
      mv "$MANIFEST.tmp" "$MANIFEST"
    fi
  fi
done <<<"$ROWS"
FAIL_MSG=""

MB=$((FREED/1024/1024))
SUMMARY="older than ${DAYS}d: $TOTAL recordings; eligible (analysis complete): $ELIGIBLE; deleted files: $DEL (${MB} MB freed); already missing locally: $MISSING; kept (analysis not complete): $((TOTAL-ELIGIBLE))"
log "$([ "$DRY" = 1 ] && echo '[dry-run] ')$SUMMARY"
if [ "$DRY" != 1 ]; then
  report_to_app audio_cleanup ok "$STARTED_AT" "$(now_iso)" "$FREED" "" "" "$SUMMARY"
fi
REPORT_DONE=1
