#!/usr/bin/env bash
# Restore drill: restore the latest backup into a temp dir and run sanity queries.
# Runnable on the Mac (needs age, sqlite3, and rclone with the akdrive remote OR a local archive).
# Touches nothing live. Run monthly; record the result in reports/.
#
#   bash scripts/verify-backup.sh --key ~/age-backup.key                # newest archive from Drive
#   bash scripts/verify-backup.sh --key ~/age-backup.key --archive ./ak_system-2026-10-29.tar.gz.age
#   RCLONE_CONFIG=~/.config/rclone/rclone.conf (default) / RCLONE_REMOTE=akdrive:AK_system_backups
set -euo pipefail
RCLONE_REMOTE="${RCLONE_REMOTE:-akdrive:AK_system_backups}"
KEY=""; ARCHIVE=""
while [ $# -gt 0 ]; do
  case "$1" in --key) KEY="$2"; shift ;; --archive) ARCHIVE="$2"; shift ;; *) echo "unknown arg $1" >&2; exit 2 ;; esac
  shift
done
[ -f "$KEY" ] || { echo "usage: $0 --key <age-private-key> [--archive <file>]" >&2; exit 2; }
for c in age sqlite3 tar; do command -v "$c" >/dev/null || { echo "missing: $c" >&2; exit 1; }; done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ak-verify.XXXXXX")"
trap '[ -d "$WORK" ] && rm -rf "${WORK:?}"' EXIT

if [ -z "$ARCHIVE" ]; then
  command -v rclone >/dev/null || { echo "missing: rclone (or pass --archive)" >&2; exit 1; }
  LATEST="$(rclone lsf "$RCLONE_REMOTE/" --files-only | grep -E '^ak_system-[0-9]{4}-[0-9]{2}-[0-9]{2}\.tar\.gz\.age$' | sort | tail -n1)"
  [ -n "$LATEST" ] || { echo "no archives found in $RCLONE_REMOTE" >&2; exit 1; }
  echo "→ downloading $LATEST"
  rclone copy "$RCLONE_REMOTE/$LATEST" "$WORK/" --checksum
  rclone copy "$RCLONE_REMOTE/$LATEST.sha256" "$WORK/" 2>/dev/null || true
  ARCHIVE="$WORK/$LATEST"
  if [ -f "$ARCHIVE.sha256" ]; then
    EXPECT="$(cut -d' ' -f1 "$ARCHIVE.sha256")"
    if command -v sha256sum >/dev/null; then GOT="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"; else GOT="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"; fi
    [ "$EXPECT" = "$GOT" ] && echo "✓ sha256 matches" || { echo "✗ sha256 mismatch" >&2; exit 1; }
  fi
fi

OUT="$WORK/restored"; mkdir -p "$OUT"
echo "→ decrypting + extracting $(basename "$ARCHIVE")"
age -d -i "$KEY" "$ARCHIVE" | tar -xzf - -C "$OUT"
DB="$OUT/ak_system.sqlite"
[ -f "$DB" ] || { echo "✗ no ak_system.sqlite in archive" >&2; exit 1; }

FAIL=0
IC="$(sqlite3 -readonly "$DB" 'PRAGMA integrity_check')"
[ "$IC" = ok ] && echo "✓ integrity_check ok" || { echo "✗ integrity_check: $IC" >&2; FAIL=1; }
FK="$(sqlite3 -readonly "$DB" 'PRAGMA foreign_key_check' | wc -l | tr -d ' ')"
echo "  foreign_key_check violations: $FK (informational)"

echo "→ row counts (restored vs recorded at snapshot time)"
if [ -f "$OUT/rowcounts.tsv" ]; then
  while IFS=$'\t' read -r t n; do
    now="$(sqlite3 -readonly "$DB" "SELECT count(*) FROM \"$t\"")"
    if [ "$now" = "$n" ]; then printf '  ✓ %-24s %s\n' "$t" "$now"; else printf '  ✗ %-24s restored=%s recorded=%s\n' "$t" "$now" "$n"; FAIL=1; fi
  done < "$OUT/rowcounts.tsv"
else
  echo "  (no rowcounts.tsv in archive)"
fi

echo "→ sanity queries"
sqlite3 -readonly "$DB" "SELECT 'tasks: '||count(*) FROM tasks; SELECT 'people: '||count(*) FROM people; SELECT 'meetings: '||count(*) FROM meetings;" | sed 's/^/  /'
sqlite3 -readonly "$DB" "SELECT 'newest meeting: '||coalesce(max(start_time),'-') FROM meetings;" 2>/dev/null | sed 's/^/  /' || true
echo "→ extra payloads"
printf '  abc-data files: %s\n  bridge-config files: %s\n' "$(find "$OUT/abc-data" -type f 2>/dev/null | wc -l | tr -d ' ')" "$(find "$OUT/bridge-config" -type f 2>/dev/null | wc -l | tr -d ' ')"

[ "$FAIL" = 0 ] && echo "RESTORE DRILL PASSED" || { echo "RESTORE DRILL FAILED" >&2; exit 1; }
