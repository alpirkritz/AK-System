# Helm APK Build (EAS)

Build a native Android APK for the Galaxy Fold 7. Requires a **stable production URL** (Railway) — not a changing Cloudflare quick tunnel.

## Prerequisites

1. Backend deployed — see [railway-production.md](./railway-production.md)
2. [Expo account](https://expo.dev/signup) (free tier works for internal APK builds)
3. Google OAuth configured — see [google-oauth-setup.md](./google-oauth-setup.md)

## 1. Configure environment

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

Edit `apps/mobile/.env`:

```env
EXPO_PUBLIC_API_URL=https://your-app.up.railway.app
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<same as GOOGLE_CLIENT_ID>
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<Android OAuth client for com.alpir.helm>
```

**Important:** `EXPO_PUBLIC_API_URL` is baked into the APK at build time. Rebuild only when the URL changes.

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
eas env:create --name EXPO_PUBLIC_API_URL --value https://your-app.up.railway.app --environment preview
eas env:create --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <client-id> --environment preview
```

## 3. Build APK

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

## 4. Install on Fold 7

1. Open the build URL from the EAS dashboard (or QR code)
2. Download APK on the phone
3. Enable **Install unknown apps** for Chrome/files app
4. Open APK → Install

## 5. Verify

- Sign in with Google
- Send a chat message to Hugo
- Trigger a push (e.g. agent completion) — notification should open chat

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "EXPO_PUBLIC_API_URL is not configured" on login | Rebuild with `.env` set; env vars must exist at build time |
| Google sign-in fails | Add SHA-1 from EAS to Android OAuth client; set `GOOGLE_ANDROID_CLIENT_ID` on Railway |
| Network error | Confirm Railway URL is HTTPS and `/api/health` returns OK |
| `eas init` required | Run `eas init` once; projectId cannot be placeholder |
| Local build without EAS | `pnpm mobile:android` — requires Android Studio + SDK (harder) |

## Development without APK

```bash
pnpm mobile          # Expo dev server
```

Use **Expo Go** on the phone for UI testing. Native push and OAuth work best on a built APK or dev client.
