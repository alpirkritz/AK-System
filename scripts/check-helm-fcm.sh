#!/usr/bin/env bash
# Fail if Helm EAS project is missing FCM V1 (required for Android push banners).
set -euo pipefail

APP_ID="02c86ee3-b071-44e9-a53c-8d22a548c49e"

SESSION="$(python3 -c "import json; print(json.load(open('$HOME/.expo/state.json'))['auth']['sessionSecret'])" 2>/dev/null || true)"
if [ -z "$SESSION" ]; then
  echo "✗  Not logged in to Expo. Run: npx eas-cli login"
  exit 1
fi

STATUS="$(python3 - "$SESSION" "$APP_ID" <<'PY'
import json, sys, urllib.request
session, app_id = sys.argv[1:3]
body = json.dumps({
  "query": """query($id: String!) {
    app { byId(appId: $id) {
      androidAppCredentials { googleServiceAccountKeyForFcmV1 { id projectIdentifier } }
    } }
  }""",
  "variables": {"id": app_id},
}).encode()
req = urllib.request.Request(
  "https://api.expo.dev/graphql",
  data=body,
  headers={
    "Content-Type": "application/json",
    "expo-session": session,
    "User-Agent": "eas-cli",
  },
  method="POST",
)
with urllib.request.urlopen(req) as res:
  data = json.load(res)["data"]["app"]["byId"]["androidAppCredentials"][0]
fcm = data.get("googleServiceAccountKeyForFcmV1")
if not fcm:
  print("MISSING")
else:
  print(f"OK:{fcm.get('projectIdentifier') or fcm['id']}")
PY
)"

if [[ "$STATUS" == MISSING ]]; then
  echo "✗  FCM V1 is NOT configured on EAS (@alpir/helm / com.alpir.helm)."
  echo "   Without it, Expo reports expoSent>=1 but no banner appears on the phone."
  echo ""
  echo "   1. Firebase Console → create/open project → add Android app package com.alpir.helm"
  echo "   2. Project settings → Service accounts → Generate new private key (JSON)"
  echo "   3. Optionally download google-services.json into apps/mobile/"
  echo "   4. bash scripts/upload-helm-fcm.sh ~/Downloads/*firebase-adminsdk*.json"
  echo "   5. Re-run the APK build"
  echo ""
  echo "   Dashboard: https://expo.dev/accounts/alpir/projects/helm/credentials"
  exit 1
fi

echo "✓  FCM V1 present ($STATUS)"
