#!/usr/bin/env bash
# Encrypt-once, upload-once backup of voice recordings to Drive (AK_system_backups/audio/).
# Runs ON the EC2 host from cron. Already-uploaded files are skipped via a local manifest
# ($BACKUP_DIR/audio-manifest.tsv: name<TAB>size<TAB>uploaded_at). Audio is immutable.
#
#   bash scripts/backup-audio.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/backup-common.sh"
KIND=audio; STARTED_AT="$(now_iso)"; FAIL_MSG=""
install_failure_trap
need age; need rclone; need curl
[ -f "$AGE_PUBKEY_FILE" ] || { FAIL_MSG="missing age public key: $AGE_PUBKEY_FILE"; echo "$FAIL_MSG" >&2; exit 1; }
AGE_RECIPIENT="$(grep -v '^#' "$AGE_PUBKEY_FILE" | head -n1 | tr -d '[:space:]')"
single_instance backup-audio
mkdir -p "$BACKUP_DIR"
MANIFEST="$BACKUP_DIR/audio-manifest.tsv"; touch "$MANIFEST"
CLEANUP_DIR="$(mktemp -d "$BACKUP_DIR/.audio.XXXXXX")"

WEB_DATA="${WEB_DATA_DIR:-$(volume_dir web-data)}"
VOICE="${VOICE_DIR:-$(voice_dir_host "$WEB_DATA")}"
if ! as_root test -d "$VOICE"; then
  log "no voice dir ($VOICE) - nothing to do"
  report_to_app audio ok "$STARTED_AT" "$(now_iso)" 0 "" "" ""; REPORT_DONE=1; exit 0
fi

UPLOADED=0; SKIPPED=0; BYTES=0
FAIL_MSG="audio upload failed"
while IFS= read -r f; do
  name="$(basename "$f")"
  case "$name" in *.partial|.*) continue ;; esac
  size="$(root_file_size "$f")"
  if grep -qF "$(printf '%s\t%s\t' "$name" "$size")" "$MANIFEST"; then SKIPPED=$((SKIPPED+1)); continue; fi
  log "encrypt + upload $name ($size bytes)"
  as_root cat "$f" | "${LOWPRIO[@]}" age -r "$AGE_RECIPIENT" > "$CLEANUP_DIR/$name.age"
  "${LOWPRIO[@]}" rclone copyto "$CLEANUP_DIR/$name.age" "$RCLONE_REMOTE/audio/$name.age" --checksum --retries 3
  rm -f "${CLEANUP_DIR:?}/${name:?}.age"
  printf '%s\t%s\t%s\n' "$name" "$size" "$(now_iso)" >> "$MANIFEST"
  UPLOADED=$((UPLOADED+1)); BYTES=$((BYTES+size))
done < <(as_root find "$VOICE" -maxdepth 1 -type f)
FAIL_MSG=""

log "audio backup: uploaded $UPLOADED, skipped $SKIPPED already-uploaded, $BYTES bytes new"
report_to_app audio ok "$STARTED_AT" "$(now_iso)" "$BYTES" "" "" ""
REPORT_DONE=1
