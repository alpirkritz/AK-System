#!/usr/bin/env bash
# Shared helpers for the host-side backup scripts. Source it, don't run it.
# Spec: docs/specs/db-source-of-truth-backup.md   Guide: docs/deploy/backup-and-restore.md

DEPLOY_PATH="${DEPLOY_PATH:-/opt/ak-system}"
BACKUP_DIR="${BACKUP_DIR:-/opt/ak-backups}"
ENV_FILE="${ENV_FILE:-$DEPLOY_PATH/deploy/production.env}"
AGE_PUBKEY_FILE="${AGE_PUBKEY_FILE:-$DEPLOY_PATH/backup.age.pub}"
RCLONE_CONFIG="${RCLONE_CONFIG:-$DEPLOY_PATH/rclone.conf}"
export RCLONE_CONFIG
RCLONE_REMOTE="${RCLONE_REMOTE:-akdrive:AK_system_backups}"
APP_URL="${APP_URL:-http://127.0.0.1:3000}"
APP_URL="${APP_URL%/}"
DB_NAME="ak_system.sqlite"
# Tables compared snapshot-to-snapshot (missing tables are skipped).
KEY_TABLES="tasks people meetings projects meeting_analyses voice_recordings memories facts finance_transactions"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
now_iso() { date -u +%FT%TZ; }

# NO_SUDO=1 (testing only) runs commands directly. Run a command as root when we are not (docker volumes live under /var/lib/docker).
as_root() { if [ "$(id -u)" -eq 0 ] || [ "${NO_SUDO:-0}" = 1 ]; then "$@"; else sudo -n "$@"; fi; }

# Lowest CPU + IO priority when available.
LOWPRIO=()
command -v nice >/dev/null 2>&1 && LOWPRIO+=(nice -n 19)
command -v ionice >/dev/null 2>&1 && LOWPRIO+=(ionice -c3)

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; return 1; }; }

load_cron_secret() {
  CRON_SECRET="${CRON_SECRET:-}"
  if [ -z "$CRON_SECRET" ] && [ -f "$ENV_FILE" ]; then
    CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
  fi
}

# Absolute host path of a docker volume's data (e.g. web-data). Compose prefixes the
# project name, so match "<project>_web-data" or a bare "web-data".
volume_dir() {
  local short="$1" full
  full="$(as_root docker volume ls -q | grep -E "(^|_)${short}\$" | head -n1 || true)"
  [ -n "$full" ] || { echo "docker volume '$short' not found" >&2; return 1; }
  as_root docker volume inspect -f '{{ .Mountpoint }}' "$full"
}

# Host path of the voice dir. VOICE_STORAGE_DIR in production.env is a container path
# (default: <dirname of DB>/voice = /data/voice); map /data/... to the web-data mountpoint.
voice_dir_host() {
  local webdata="$1" cdir=""
  [ -f "$ENV_FILE" ] && cdir="$(grep '^VOICE_STORAGE_DIR=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
  cdir="${cdir:-/data/voice}"
  case "$cdir" in
    /data/*) echo "$webdata/${cdir#/data/}" ;;
    *) echo "$cdir" ;;
  esac
}

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r\t' '   ' | cut -c1-1500; }

# report_to_app <kind> <status> <startedAt> <finishedAt> [sizeBytes] [sha256] [driveFileId] [error]
report_to_app() {
  local kind="$1" status="$2" started="$3" finished="$4" size="${5:-}" sha="${6:-}" fid="${7:-}" err="${8:-}"
  load_cron_secret
  [ -n "${CRON_SECRET:-}" ] || { log "no CRON_SECRET - cannot report"; return 0; }
  local body
  body="{\"kind\":\"$(json_escape "$kind")\",\"status\":\"$status\",\"startedAt\":\"$started\",\"finishedAt\":\"$finished\""
  body+=",\"sizeBytes\":${size:-null},\"sha256\":$([ -n "$sha" ] && echo "\"$sha\"" || echo null)"
  body+=",\"driveFileId\":$([ -n "$fid" ] && echo "\"$(json_escape "$fid")\"" || echo null)"
  body+=",\"error\":$([ -n "$err" ] && echo "\"$(json_escape "$err")\"" || echo null)}"
  curl -sS -m 30 -X POST -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
    -d "$body" "$APP_URL/api/cron/backup-report" >/dev/null 2>&1 \
    || log "warning: could not report to $APP_URL/api/cron/backup-report"
}

# Failure handling: any failing command reports status=failed once. Call after setting
# KIND and STARTED_AT. Scripts set REPORT_DONE=1 after a successful report.
# FAIL_MSG, when non-empty, overrides the generic message.
install_failure_trap() {
  REPORT_DONE=0
  trap '_on_err $?' ERR
  trap '_on_exit $?' EXIT
}
_on_err() { LAST_ERR_CODE="$1"; LAST_ERR_LINE="${BASH_LINENO[0]:-?}"; }
_on_exit() {
  local rc="$1"
  if [ "$rc" -ne 0 ] && [ "${REPORT_DONE:-0}" -eq 0 ]; then
    REPORT_DONE=1
    log "FAILED (exit $rc, near line ${LAST_ERR_LINE:-?})"
    [ "${NO_REPORT:-0}" = 1 ] || report_to_app "${KIND:-backup}" failed "${STARTED_AT:-$(now_iso)}" "$(now_iso)" "" "" "" \
      "${FAIL_MSG:-script failed (exit $rc) near line ${LAST_ERR_LINE:-?}}"
  fi
  if [ -n "${CLEANUP_DIR:-}" ] && [ -d "$CLEANUP_DIR" ]; then rm -rf "${CLEANUP_DIR:?}"; fi
  return 0
}

# Prevent overlapping runs of the same job.
single_instance() {
  mkdir -p "$BACKUP_DIR"
  exec 9>"$BACKUP_DIR/.lock-$1"
  flock -n 9 || { echo "another $1 run is in progress - exiting"; REPORT_DONE=1; exit 0; }
}

sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
file_size() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }

# "table<TAB>count" for every KEY_TABLES table present in a sqlite file.
row_counts() {
  local db="$1" t
  for t in $KEY_TABLES; do
    if [ "$(sqlite3 -readonly "$db" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$t'")" = 1 ]; then
      printf '%s\t%s\n' "$t" "$(sqlite3 -readonly "$db" "SELECT count(*) FROM \"$t\"")"
    fi
  done
}

# compare_counts <prev-file> <new-file> -> a line per table that dropped > 20% (ignores tables < 10 rows).
compare_counts() {
  awk -F'\t' 'NR==FNR{prev[$1]=$2; next} ($1 in prev) && prev[$1] >= 10 && $2 < prev[$1]*0.8 {printf "%s: %s -> %s\n", $1, prev[$1], $2}' "$1" "$2"
}

# dow YYYY-MM-DD -> 0=Sunday (GNU date; BSD fallback for local testing)
dow() { date -u -d "$1" +%w 2>/dev/null || date -u -j -f %Y-%m-%d "$1" +%w; }

# prune_candidates [daily weekly monthly]: stdin = remote file names containing YYYY-MM-DD;
# prints names to delete. Keeps newest 14 (daily) + newest 8 Sundays + newest 12 first-of-month.
prune_candidates() {
  local d="${1:-14}" w="${2:-8}" m="${3:-12}"
  local sorted
  sorted="$(grep -E '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sed -E 's/^(.*([0-9]{4}-[0-9]{2}-[0-9]{2}).*)$/\2 \1/' | sort -r)"
  [ -n "$sorted" ] || return 0
  local date name nd=0 nw=0 nm=0 k
  while read -r date name; do
    k=0
    if [ "$nd" -lt "$d" ]; then k=1; nd=$((nd+1)); fi
    if [ "$(dow "$date")" = 0 ] && [ "$nw" -lt "$w" ]; then k=1; nw=$((nw+1)); fi
    if [ "${date:8:2}" = 01 ] && [ "$nm" -lt "$m" ]; then k=1; nm=$((nm+1)); fi
    [ "$k" -eq 1 ] || echo "$name"
  done <<<"$sorted"
}

# Size in bytes of a file that may only be readable by root (GNU stat; BSD fallback for local testing).
root_file_size() { as_root stat -c %s "$1" 2>/dev/null || as_root stat -f %z "$1"; }
