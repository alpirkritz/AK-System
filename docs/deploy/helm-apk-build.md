# Helm APK Build (EAS)

Build a native Android APK for the Galaxy Fold 7. The backend runs **locally on the Mac** (`pnpm serve`) and is exposed over HTTPS with a **Cloudflare Tunnel** — there is no Railway/cloud backend. The EAS build service is only used to compile the APK; the app itself talks to your local machine through the tunnel URL.

The APK needs a **stable HTTPS URL** that reaches the local backend. A Cloudflare *quick* tunnel (`*.trycloudflare.com`) changes on every restart, so prefer a **named tunnel** with a domain for anything long-lived — see [cloudflare-stable-url.md](./cloudflare-stable-url.md).

## Prerequisites

1. Backend running locally over the tunnel — `pnpm serve` (see [`scripts/serve.sh`](../../scripts/serve.sh)) then `bash scripts/set-tunnel-url.sh https://YOUR-URL`
2. [Expo account](https://expo.dev/signup) (free tier works for internal APK builds)
3. Google OAuth configured — see [google-oauth-setup.md](./google-oauth-setup.md)

## 1. Configure environment

The mobile env is generated from your **local** web env. Set the tunnel URL once and it is written into `apps/mobile/.env` automatically:

```bash
# after the tunnel is up (URL is in /tmp/ak-tunnel.log for a quick tunnel):
bash scripts/set-tunnel-url.sh https://YOUR-URL.trycloudflare.com
```

This updates `apps/web/.env.local` (`NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`) and writes `apps/mobile/.env`:

```env
EXPO_PUBLIC_API_URL=https://YOUR-URL.trycloudflare.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<GOOGLE_CLIENT_ID from apps/web/.env.local>
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<Android OAuth client for com.alpir.helm>
```

The APK build ([`scripts/helm-apk-eas.sh`](../../scripts/helm-apk-eas.sh)) reads these values from `apps/web/.env.local`.

**Important:** `EXPO_PUBLIC_API_URL` is baked into the APK at build time. If the tunnel URL changes you must rebuild the APK — another reason to use a named tunnel.

## 2. One-time EAS setup

```bash
cd apps/mobile
npm install -g eas-cli   # or: npx eas-cli
eas login
eas init                 # links project, writes projectId to app.config.ts extra.eas
```

After `eas init`, commit the updated `projectId` in `app.config.ts`.

Optional — store env in EAS (for CI builds without local `.env`):

```bash
eas env:create --name EXPO_PUBLIC_API_URL --value https://YOUR-URL --environment preview
eas env:create --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <client-id> --environment preview
```

## 3. Configure FCM push credentials (required for notifications)

A standalone APK (unlike Expo Go) delivers push through **Firebase Cloud Messaging**. Without FCM credentials in the build, the server reports `expoSent: 1` but **no banner appears on the phone**.

1. Create a Firebase project and add an Android app with package `com.alpir.helm`.
2. In Firebase → Project settings → Service accounts, generate a private key (JSON).
3. Upload it to EAS:
   ```bash
   cd apps/mobile
   eas credentials
   ```
   Choose Android → **FCM V1** → upload the service account JSON.
4. Verify it is set: expo.dev → project `@alpir/helm` → Credentials → Android → **FCM V1** shows a key.

FCM credentials are baked into the build, so you must configure them **before** building the APK.

## 4. Build APK

From repo root:

```bash
pnpm mobile:build:apk
```

Or manually:

```bash
cd apps/mobile
eas build --platform android --profile preview --non-interactive
```

Profile `preview` in `eas.json` produces an **APK** (`buildType: apk`), not an AAB.

> **Important:** `EXPO_PUBLIC_API_URL` is baked in from the generated `apps/mobile/.env` (written by `set-tunnel-url.sh`, uploaded to the build since it is not gitignored). It is intentionally **not** hardcoded in [`eas.json`](../../apps/mobile/eas.json) — a stale value there would silently override your local `.env`. It must point at the **currently live** tunnel URL for the Mac backend; re-run `set-tunnel-url.sh` and rebuild whenever the tunnel URL changes (another reason to prefer a named tunnel).

## 5. Install on Fold 7

1. Open the build URL from the EAS dashboard (or QR code)
2. Download APK on the phone
3. Enable **Install unknown apps** for Chrome/files app
4. Open APK → Install

## 6. Verify push

1. Open the app → **הגדרות** (in-app, not the browser).
2. Tap **הפעל התראות Push** — status should read `מופעל ✓` and a `token: …` line should appear. If no token appears, push cannot work (see troubleshooting).
3. Tap **שלח בדיקה** — the status line reports `נשלח: X PWA + Y Helm`.
   - `Y >= 1` and a banner appears → working.
   - `Y >= 1` but no banner → FCM credentials or device notification settings (see below).
   - `Y = 0` → the token was not registered on the server (wrong API URL, or registration failed).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "EXPO_PUBLIC_API_URL is not configured" on login | Rebuild with `.env` / `eas.json` env set; env vars must exist at build time |
| Google sign-in fails | Add SHA-1 from EAS to Android OAuth client; set `GOOGLE_ANDROID_CLIENT_ID` in `apps/web/.env.local` |
| Network error | Confirm the Mac is running `pnpm serve`, the tunnel is up, and `https://YOUR-URL/api/health` returns OK |
| `eas init` required | Run `eas init` once; projectId cannot be placeholder |
| No `token: …` shown after enabling push | Missing EAS `projectId` (check `app.config.ts` `extra.eas.projectId`) or notification permission denied at the OS level |
| Test reports `Y = 0 Helm` | App points at a stale/wrong tunnel URL; re-run `set-tunnel-url.sh`, rebuild the APK, then re-enable push |
| Test reports `Y >= 1 Helm` but no banner | FCM V1 credentials not configured in the build (see step 3), or the OS blocks the notification — check **Settings → Apps → Helm → Notifications**, disable battery optimization, and turn off Do Not Disturb |
| Local build without EAS | `pnpm mobile:android` — requires Android Studio + SDK (harder) |

## Development without APK

```bash
pnpm mobile          # Expo dev server
```

Use **Expo Go** on the phone for UI testing. Native push and OAuth work best on a built APK or dev client.
