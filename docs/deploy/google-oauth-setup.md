# Google OAuth Setup (Web + Helm Mobile)

Configure Google Cloud Console credentials for production (Railway) and the Helm Android app.

## 1. Open Google Cloud Console

[APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)

Use the same project as your existing AK System OAuth client, or create a new one.

## 2. Web OAuth client (browser + NextAuth)

Used by: web app sign-in, NextAuth session.

**Authorized redirect URIs** — add all that apply:

| Environment | Redirect URI |
|-------------|--------------|
| Local dev | `http://localhost:3000/api/auth/callback/google` |
| Railway / production | `https://<your-domain>/api/auth/callback/google` |
| Cloudflare Tunnel (if used) | `https://<tunnel-domain>/api/auth/callback/google` |

**Authorized JavaScript origins** (optional, for calendar):

- `https://<your-domain>`
- `http://localhost:3000`

Copy **Client ID** and **Client secret** to Railway:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## 3. Android OAuth client (Helm native app)

Used by: Helm app Google Sign-In on Galaxy Fold.

1. **Create credentials → OAuth client ID → Android**
2. Package name: `com.alpir.helm`
3. SHA-1 certificate fingerprint:
   - **EAS Build:** run `eas credentials` after first build, or use Expo's debug keystore fingerprint from the EAS dashboard
   - **Local debug:** `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`

Copy the Android **Client ID** to:

- Railway: `GOOGLE_ANDROID_CLIENT_ID`
- `apps/mobile/.env`: `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` (optional; falls back to web client ID)

The backend accepts tokens from both Web and Android client IDs (`apps/web/src/lib/mobile-auth.ts`).

## 4. Calendar OAuth (optional)

If using Google Calendar integration, add redirect URI:

```
https://<your-domain>/api/auth/google-calendar/callback
```

Set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and `GOOGLE_CALENDAR_REFRESH_TOKEN` in Railway.

## 5. Checklist after URL change

When moving from local tunnel to Railway:

- [ ] Update `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL` in Railway
- [ ] Add production redirect URI in Google Console
- [ ] Update `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` and rebuild APK if needed
- [ ] Test web sign-in at `https://<domain>/login`
- [ ] Test Helm sign-in on device

## 6. ALLOWED_EMAILS

Set in Railway to restrict sign-in:

```
ALLOWED_EMAILS=you@example.com,other@example.com
```

Applies to both web NextAuth and mobile JWT (`verifyGoogleIdToken`).
