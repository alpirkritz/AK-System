# Production Deployment Guides

Step-by-step guides for cloud deployment and Helm mobile app.

| Order | Guide | Purpose |
|-------|-------|---------|
| 1 | [railway-production.md](./railway-production.md) | Stable HTTPS backend (no Mac + tunnel) |
| 2 | [google-oauth-setup.md](./google-oauth-setup.md) | Web + Android OAuth for sign-in |
| 3 | [cron-setup.md](./cron-setup.md) | Scheduled jobs via GitHub Actions |
| 4 | [helm-apk-build.md](./helm-apk-build.md) | Native Android APK via EAS |
| 5 | [whatsapp-bridge-vm.md](./whatsapp-bridge-vm.md) | Optional WhatsApp 24/7 on VM |

## Quick files

- Env template: [`deploy/railway.env.example`](../../deploy/railway.env.example)
- Docker full stack: [`deploy/docker-compose.production.yml`](../../deploy/docker-compose.production.yml)
- Validate env locally: `bash scripts/validate-production-env.sh` (after sourcing env)
- Build APK: `pnpm mobile:build:apk` (after `eas login` + `eas init`)

## Local development (Mac + tunnel)

See root [`DEPLOY.md`](../../DEPLOY.md) — section "הרצה מקומית + Cloudflare Tunnel".
