#!/usr/bin/env bash
# Upload Firebase FCM V1 service-account JSON to EAS for Helm (@alpir/helm).
# Usage: bash scripts/upload-helm-fcm.sh /path/to/firebase-adminsdk.json
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_PATH="${1:-}"
APP_ID="02c86ee3-b071-44e9-a53c-8d22a548c49e"
ACCOUNT_ID="0dcf98cd-9a71-4503-b74c-9684d6a7e839"
ANDROID_CREDS_ID="5ffd4799-e255-4c1b-8f6d-b3ac24a3c8d7"

if [ -z "$KEY_PATH" ] || [ ! -f "$KEY_PATH" ]; then
  echo "✗  Usage: bash scripts/upload-helm-fcm.sh /path/to/*-firebase-adminsdk-*.json"
  echo "   Create the key: Firebase Console → Project settings → Service accounts → Generate new private key"
  echo "   Package/app id must be: com.alpir.helm"
  exit 1
fi

SESSION="$(python3 -c "import json; print(json.load(open('$HOME/.expo/state.json'))['auth']['sessionSecret'])")"
if [ -z "$SESSION" ]; then
  echo "✗  Not logged in to Expo. Run: npx eas-cli login"
  exit 1
fi

python3 - "$KEY_PATH" "$SESSION" "$ACCOUNT_ID" "$ANDROID_CREDS_ID" "$APP_ID" <<'PY'
import json, sys, urllib.request

key_path, session, account_id, android_creds_id, app_id = sys.argv[1:6]
with open(key_path) as f:
    json_key = json.load(f)

required = ("type", "project_id", "private_key_id", "private_key", "client_email")
missing = [k for k in required if k not in json_key]
if missing:
    raise SystemExit(f"✗  Invalid service account JSON (missing: {', '.join(missing)})")
if json_key.get("type") != "service_account":
    raise SystemExit("✗  JSON type must be service_account")

def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
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
        payload = json.load(res)
    if payload.get("errors"):
        raise SystemExit("GraphQL error: " + json.dumps(payload["errors"], indent=2))
    return payload["data"]

# already configured?
status = gql(
    """query($id: String!) {
      app {
        byId(appId: $id) {
          androidAppCredentials { googleServiceAccountKeyForFcmV1 { id projectIdentifier } }
        }
      }
    }""",
    {"id": app_id},
)
existing = status["app"]["byId"]["androidAppCredentials"][0].get("googleServiceAccountKeyForFcmV1")
if existing:
    print(f"✓  FCM V1 already set (project={existing.get('projectIdentifier')}, id={existing['id']})")
    sys.exit(0)

created = gql(
    """mutation($input: GoogleServiceAccountKeyInput!, $accountId: ID!) {
      googleServiceAccountKey {
        createGoogleServiceAccountKey(googleServiceAccountKeyInput: $input, accountId: $accountId) {
          id
          projectIdentifier
        }
      }
    }""",
    {"input": {"jsonKey": json_key}, "accountId": account_id},
)["googleServiceAccountKey"]["createGoogleServiceAccountKey"]

print(f"→ Uploaded key {created['id']} (project={created.get('projectIdentifier')})")

assigned = gql(
    """mutation($id: ID!, $keyId: ID!) {
      androidAppCredentials {
        setGoogleServiceAccountKeyForFcmV1(id: $id, googleServiceAccountKeyId: $keyId) {
          id
          googleServiceAccountKeyForFcmV1 { id projectIdentifier }
        }
      }
    }""",
    {"id": android_creds_id, "keyId": created["id"]},
)["androidAppCredentials"]["setGoogleServiceAccountKeyForFcmV1"]

fcm = assigned["googleServiceAccountKeyForFcmV1"]
print(f"✓  FCM V1 assigned to com.alpir.helm (project={fcm.get('projectIdentifier')})")
PY
