# Production Deployment Guides

Step-by-step guides for self-hosted deployment and the Helm mobile app.

**Recommended path: EC2 + Docker, driven from your Mac — no Railway, no external CI.**

| Order | Guide | Purpose |
|-------|-------|---------|
| 1 | [ec2-production.md](./ec2-production.md) | Stable HTTPS backend on EC2 Free Tier via local `pnpm deploy:ec2` |
| 2 | [google-oauth-setup.md](./google-oauth-setup.md) | Web + Android OAuth for sign-in |
| 3 | [cron-setup.md](./cron-setup.md) | Scheduled jobs via server crontab (GitHub Actions = legacy) |
| 4 | [helm-apk-build.md](./helm-apk-build.md) | Native Android APK via EAS |
| 5 | [whatsapp-bridge-vm.md](./whatsapp-bridge-vm.md) | Optional WhatsApp 24/7 on VM |

Legacy: [railway-production.md](./railway-production.md) (Railway cloud deploy — kept for reference).

## Quick files

- Env template: [`deploy/production.env.example`](../../deploy/production.env.example)
- Deploy connection template: [`deploy/ec2.env.example`](../../deploy/ec2.env.example)
- Docker stack: [`deploy/docker-compose.production.yml`](../../deploy/docker-compose.production.yml)
- Generate prod env: `bash scripts/generate-production-env.sh https://your-domain.com`
- Local CI gate: `pnpm run ci:local` (lint + test + e2e + build)
- Deploy: `pnpm deploy:ec2`
- Validate env locally: `DEPLOY_CHECK=1 pnpm run ci:local`
- Build APK: `pnpm mobile:build:apk` (after `eas login` + `eas init`)

## Local development (Mac + tunnel)

See root [`DEPLOY.md`](../../DEPLOY.md) — section "הרצה מקומית + Cloudflare Tunnel".
