# Railway Production Deployment

Deploy the AK System web app to Railway for a **stable HTTPS URL** (no Mac + Cloudflare Tunnel required). Required before building the Helm Android APK with a fixed `EXPO_PUBLIC_API_URL`.

## Prerequisites

- [Railway](https://railway.app) account linked to GitHub
- Google Cloud OAuth credentials (Web + optional Android client for Helm)
- VAPID keys for Web Push: `npx web-push generate-vapid-keys`

## 1. Create project

1. Railway → **New Project** → **Deploy from GitHub repo** → select this repo.
2. **Settings → Source** → Branch = `main` (or your deploy branch).
3. **Settings → Root Directory** → leave **empty** (repo root). Railway must see `pnpm-lock.yaml` and `railway.toml`.

## 2. Add volume

1. **Settings → Volumes** → **Add Volume**
2. Mount path: `/data`
3. Variable: `DATABASE_PATH=/data/ak_system.sqlite`

## 3. Environment variables

Copy from [`deploy/railway.env.example`](../../deploy/railway.env.example) into Railway **Variables**.

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_APP_URL` | Yes | `https://<service>.up.railway.app` |
| `NEXTAUTH_URL` | Yes | Same as `NEXT_PUBLIC_APP_URL` |
| `NEXTAUTH_SECRET` | Yes | `openssl rand -base64 32` |
| `ALLOWED_EMAILS` | Yes | Your Google email(s), comma-separated |
| `DATABASE_PATH` | Yes | `/data/ak_system.sqlite` |
| `GOOGLE_CLIENT_ID` / `SECRET` | Yes | Web OAuth client |
| `GOOGLE_ANDROID_CLIENT_ID` | For Helm | Android OAuth client for `com.alpir.helm` |
| `CRON_SECRET` | Yes | Protects `/api/cron/*` endpoints |
| `VAPID_*` | For push | Web Push keys |
| `GEMINI_API_KEY` | For Hugo | Chat and agents |

Mobile JWT uses **`NEXTAUTH_SECRET`** (same secret as NextAuth) — no separate `MOBILE_JWT_SECRET`.

## 4. Build & start commands

Configured in [`railway.toml`](../../railway.toml):

- **Build:** `pnpm install --frozen-lockfile && pnpm run build`
- **Start:** `bash scripts/railway-start.sh` (runs `db:push` then `next start`)

If the dashboard overrides start command, set it to:

```bash
bash scripts/railway-start.sh
```

## 5. Verify deploy

```bash
curl -s https://<your-domain>/api/health
curl -s https://<your-domain>/api/version
```

Open the URL in a browser and sign in with Google.

## 6. Google OAuth

See [google-oauth-setup.md](./google-oauth-setup.md). Add redirect URI:

```
https://<your-domain>/api/auth/callback/google
```

## 7. Cron jobs

Railway has no built-in cron. Use GitHub Actions (included in this repo) or [cron-job.org](https://cron-job.org).

See [cron-setup.md](./cron-setup.md).

## 8. Helm mobile app

After deploy, set the stable URL in `apps/mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=https://<your-domain>
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<same as GOOGLE_CLIENT_ID>
```

Then build APK: see [helm-apk-build.md](./helm-apk-build.md).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Build uses old commit | Settings → Source → correct branch → Redeploy |
| "table not found" | Check volume mounted at `/data`; redeploy runs `db:push` |
| OAuth redirect mismatch | Update Google Console URIs to match `NEXTAUTH_URL` |
| Cron 401 | Set `CRON_SECRET` in Railway and GitHub repo secrets |
| Helm sign-in fails | Add `GOOGLE_ANDROID_CLIENT_ID` to Railway variables |
