#!/usr/bin/env bash
# Validate required production env vars (EC2 / Docker deploy).
# Usage: set -a && source deploy/production.env && set +a && bash scripts/validate-production-env.sh
set -euo pipefail

missing=0

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "❌ missing: $name"
    missing=1
  else
    echo "✓ $name"
  fi
}

echo "Checking production environment..."
require NEXT_PUBLIC_APP_URL
require NEXTAUTH_URL
require NEXTAUTH_SECRET
require ALLOWED_EMAILS
require DATABASE_PATH
require GOOGLE_CLIENT_ID
require GOOGLE_CLIENT_SECRET
require CRON_SECRET
require VAPID_PUBLIC_KEY
require VAPID_PRIVATE_KEY
require VAPID_EMAIL

if [ "$missing" -ne 0 ]; then
  echo ""
  echo "Fix missing variables. Template: deploy/production.env.example"
  exit 1
fi

if [[ ! "$NEXT_PUBLIC_APP_URL" =~ ^https:// ]]; then
  echo "⚠  NEXT_PUBLIC_APP_URL should use HTTPS in production"
fi

if [ "$NEXTAUTH_URL" != "$NEXT_PUBLIC_APP_URL" ]; then
  echo "⚠  NEXTAUTH_URL should match NEXT_PUBLIC_APP_URL"
fi

echo ""
echo "✓ Required production variables present"
