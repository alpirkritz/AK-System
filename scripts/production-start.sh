#!/usr/bin/env bash
# Production start (EC2 / Docker / any host): ensure SQLite schema then run Next.js.
# Used as the container CMD and by legacy scripts/railway-start.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

: "${DATABASE_PATH:=/data/ak_system.sqlite}"
export DATABASE_PATH

mkdir -p "$(dirname "$DATABASE_PATH")"

# Persist editable ABC markdown (A_Agents / S_Skills / …) across redeploys.
#
# Rules, per file:
#   - not on the volume yet            → copy from the image seed
#   - on the volume, identical to seed → nothing to do
#   - on the volume, identical to what we *last seeded* (recorded in
#     $ABC_ROOT/.seed-manifest) → the user never touched it in the UI, so a
#     repo change is safe to ship: overwrite with the new seed
#   - on the volume, differs from both → UI-edited; keep it, log a warning
#   - listed in ABC_SEED_FORCE_FILES (comma-separated, relative paths) → always
#     overwrite from seed. One-shot escape hatch for files that predate the
#     manifest; remove from production.env after the deploy that needed it.
#
# Why: the old `cp -an` (no-clobber) meant a repo edit to an agent card that
# already existed on the volume silently never reached production — the daily
# Tier 1 QA agent kept running its first-deploy template long after the repo
# had a new one. Only brand-new files ever shipped.
: "${ABC_ROOT:=/data/abc}"
SEED_ROOT="${ROOT_DIR}/abc-seed"
if [ -d "$SEED_ROOT" ]; then
  echo "→ seeding ABC workspace into ABC_ROOT=$ABC_ROOT"
  mkdir -p "$ABC_ROOT"
  MANIFEST="$ABC_ROOT/.seed-manifest"
  NEW_MANIFEST="$(mktemp)"
  [ -f "$MANIFEST" ] || : > "$MANIFEST"
  FORCE_LIST=",${ABC_SEED_FORCE_FILES:-},"
  seeded=0; updated=0; kept=0
  for dir in A_Agents S_Skills C_Core B_Brain M_Memory O_Output; do
    [ -d "$SEED_ROOT/$dir" ] || continue
    mkdir -p "$ABC_ROOT/$dir"
    while IFS= read -r -d '' src; do
      rel="${src#"$SEED_ROOT"/}"
      dest="$ABC_ROOT/$rel"
      seed_hash="$(sha256sum "$src" | cut -d' ' -f1)"
      printf '%s %s\n' "$rel" "$seed_hash" >> "$NEW_MANIFEST"
      if [ ! -e "$dest" ]; then
        mkdir -p "$(dirname "$dest")"
        cp -a "$src" "$dest"; seeded=$((seeded + 1)); continue
      fi
      cur_hash="$(sha256sum "$dest" | cut -d' ' -f1)"
      [ "$cur_hash" = "$seed_hash" ] && continue
      prev_hash="$(awk -v r="$rel" '$1 == r { print $2; exit }' "$MANIFEST")"
      case "$FORCE_LIST" in *",$rel,"*) forced=1 ;; *) forced=0 ;; esac
      if [ "$forced" = 1 ] || { [ -n "$prev_hash" ] && [ "$cur_hash" = "$prev_hash" ]; }; then
        cp -a "$src" "$dest"; updated=$((updated + 1))
        if [ "$forced" = 1 ]; then echo "   ↻ updated $rel (forced)"; else echo "   ↻ updated $rel"; fi
      else
        kept=$((kept + 1))
        echo "   ⚠ kept UI-edited $rel (differs from image seed — edit in /agents/manage or set ABC_SEED_FORCE_FILES)"
      fi
    done < <(find "$SEED_ROOT/$dir" -type f -print0)
  done
  mv "$NEW_MANIFEST" "$MANIFEST"
  echo "   seeded=$seeded updated=$updated kept=$kept"
fi
export ABC_ROOT

echo "→ db:push (DATABASE_PATH=$DATABASE_PATH)"
if ! pnpm db:push; then
  echo "⚠  db:push reported an error (often harmless if schema is already up to date)."
fi

echo "→ starting @ak-system/web (ABC_ROOT=$ABC_ROOT)"
exec pnpm --filter @ak-system/web start
