#!/usr/bin/env bash
# One-shot Railway deploy for AK System web app.
#
# The ONLY manual step is a one-time browser login:
#   railway login
#
# Then run:
#   bash scripts/railway-deploy.sh
#
# This script then does EVERYTHING else automatically:
#   - create/link a Railway project + service
#   - add a persistent volume at /data
#   - push all env vars from deploy/railway.env
#   - generate a public HTTPS domain
#   - deploy, and rewrite the app URL vars to the real domain
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/railway.env"
PROJECT_NAME="${RAILWAY_PROJECT_NAME:-ak-system}"
SERVICE_NAME="${RAILWAY_SERVICE_NAME:-web}"

cd "$ROOT_DIR"

# ── 0. Auth gate (only step a human must do) ──────────────────────────────────
if ! railway whoami >/dev/null 2>&1; then
  echo "✗  Not logged in to Railway."
  echo ""
  echo "   Run this ONCE (opens a browser), then re-run this script:"
  echo "     railway login"
  echo ""
  echo "   Headless/SSH? Use:  railway login --browserless"
  exit 1
fi
echo "✓  Logged in as: $(railway whoami 2>/dev/null)"

# ── 1. Generate env file if missing ───────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "→ deploy/railway.env missing — generating from apps/web/.env.local"
  bash "$SCRIPT_DIR/generate-railway-env.sh" "https://${PROJECT_NAME}.up.railway.app"
fi

# ── 2. Link or create project ─────────────────────────────────────────────────
if [ -f "$ROOT_DIR/.railway/config.json" ] || railway status >/dev/null 2>&1; then
  echo "✓  Project already linked"
else
  echo "→ Creating Railway project: $PROJECT_NAME"
  railway init --name "$PROJECT_NAME" || railway link || {
    echo "✗  Could not create/link a project. Run 'railway init' manually."
    exit 1
  }
fi

# ── 3. First deploy (creates the service from this repo) ──────────────────────
echo "→ Deploying (this builds on Railway; first build can take several minutes)..."
railway up -y --ci || railway up -y --detach || {
  echo "⚠  Initial 'railway up' failed; continuing to configure — re-run after fixing."
}

# ── 4. Persistent volume for SQLite ───────────────────────────────────────────
echo "→ Ensuring volume at /data"
railway volume add -m /data 2>&1 | grep -vi "already" || true

# ── 5. Push env variables ─────────────────────────────────────────────────────
echo "→ Setting environment variables from $ENV_FILE"
VARS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" != *=* ]] && continue
  VARS+=("$line")
done < "$ENV_FILE"

if [ "${#VARS[@]}" -gt 0 ]; then
  railway variable set --skip-deploys "${VARS[@]}" || {
    echo "⚠  Bulk set failed; setting one-by-one"
    for kv in "${VARS[@]}"; do
      railway variable set --skip-deploys "$kv" || echo "   ✗ failed: ${kv%%=*}"
    done
  }
fi

# ── 6. Generate public domain ─────────────────────────────────────────────────
echo "→ Generating public domain"
DOMAIN_OUT="$(railway domain 2>&1 || true)"
echo "$DOMAIN_OUT"
DOMAIN="$(echo "$DOMAIN_OUT" | grep -oE 'https://[a-zA-Z0-9.-]+' | head -1 || true)"

if [ -n "$DOMAIN" ]; then
  echo "✓  Public URL: $DOMAIN"
  echo "→ Rewriting app URL vars to real domain"
  railway variable set --skip-deploys \
    "NEXT_PUBLIC_APP_URL=$DOMAIN" \
    "NEXTAUTH_URL=$DOMAIN" || true
fi

# ── 7. Final deploy with full config ──────────────────────────────────────────
echo "→ Redeploying with final configuration"
railway up -y --detach || railway redeploy -y || true

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓  Railway deploy initiated."
[ -n "$DOMAIN" ] && echo "   App URL:        $DOMAIN"
echo "   Watch build:    railway logs"
echo "   Dashboard:      railway open"
echo ""
echo "Next manual steps (one-time):"
echo "  1. Google OAuth redirect URI:"
[ -n "$DOMAIN" ] && echo "       $DOMAIN/api/auth/callback/google"
echo "  2. GitHub repo secrets for cron (Settings → Secrets → Actions):"
echo "       CRON_SECRET  (same as in deploy/railway.env)"
[ -n "$DOMAIN" ] && echo "       APP_URL=$DOMAIN"
echo "════════════════════════════════════════════════════════════"
