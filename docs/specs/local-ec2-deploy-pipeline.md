# Local EC2 Deploy Pipeline (no Railway / no external CI)

> **Slug:** `local-ec2-deploy-pipeline`
> **Status:** Draft
> **Last Updated:** 2026-06-30

## Goal

Replace the Railway-based deploy flow and the GitHub Actions cron with a fully local
pipeline driven from the Mac. The developer runs tests and a build locally, then
deploys to a single AWS EC2 Free Tier instance over SSH using the existing Docker
Compose stack. Scheduled jobs (morning briefing, reminders, agent triggers) run from
`crontab` on the EC2 box, so nothing depends on an external CI/CD service. Railway
scripts stay in the repo as legacy but are no longer the recommended path.

## User Stories

- As the operator, I want a single command (`pnpm ci`) that lints, tests, and builds
  locally so I gate every deploy on a green pipeline without GitHub Actions.
- As the operator, I want a single command (`pnpm deploy:ec2`) that pushes the current
  code to my EC2 instance and restarts the containers, so I never touch the Railway dashboard.
- As the operator, I want a one-time `ec2-bootstrap.sh` that prepares a fresh Ubuntu
  instance (Docker, swap, app directory) so setup is repeatable.
- As the operator, I want cron jobs to run on the EC2 box itself so reminders fire 24/7
  without GitHub Actions.

## Acceptance Criteria

- [ ] `pnpm ci` runs `pnpm -r run lint`, `pnpm test`, `pnpm e2e` (skippable via `SKIP_E2E=1`), and `pnpm build`, failing fast on the first error.
- [ ] `scripts/ci.sh` optionally validates production env when `DEPLOY_CHECK=1` is set.
- [ ] `deploy/production.env.example` exists with generic (non-Railway) placeholder URLs and is the documented source of production env.
- [ ] `scripts/generate-production-env.sh <APP_URL>` writes `deploy/production.env` from `apps/web/.env.local` (git-ignored).
- [ ] `scripts/validate-production-env.sh` references `deploy/production.env` (not `deploy/railway.env`).
- [ ] The production container runs `db:push` before `next start` (via a shared `scripts/production-start.sh`), so a fresh volume gets a schema without manual steps.
- [ ] `scripts/ec2-bootstrap.sh` installs Docker + Compose plugin, creates a 2 GB swap file, and prepares `/opt/ak-system` on Ubuntu 22.04.
- [ ] `scripts/deploy-ec2.sh` reads `deploy/ec2.env`, runs CI (skippable via `SKIP_CI=1`), syncs code to the instance, runs `docker compose ... up -d --build`, and performs a health check.
- [ ] `pnpm deploy:ec2` invokes the deploy script.
- [ ] `deploy/crontab.example` covers the same endpoints as `.github/workflows/cron.yml`, pointed at `http://127.0.0.1:3000`.
- [ ] `scripts/install-server-cron.sh` installs that crontab on the server using `CRON_SECRET` from `production.env`.
- [ ] HTTPS guidance exists for both a Caddy reverse proxy (`deploy/Caddyfile.example`) and reusing the Cloudflare Tunnel on EC2.
- [ ] `docs/deploy/ec2-production.md` documents instance type, Security Group, Elastic IP, and the full setup flow.
- [ ] `DEPLOY.md` and `docs/deploy/README.md` present EC2 + Docker as the recommended path; Railway is marked legacy.
- [ ] `deploy/ec2.env` is added to `.gitignore`.

## Target Environment

AWS EC2 Free Tier (new account): ~750 hours/month of `t2.micro` / `t3.micro`
(1 vCPU, 1 GB RAM) for 12 months. `t4g.micro` (arm64) is also eligible and the existing
`Dockerfile` (`node:20-bookworm-slim`) supports arm64.

Constraints:

- 1 GB RAM is tight for web + WhatsApp bridge together. Phase 1 runs the web service only;
  the bridge stays optional (omitted via a compose override or run later on a separate box).
- A 2 GB swap file is created during bootstrap to survive `next build` memory spikes.
- HTTPS via Caddy + Let's Encrypt (with a domain) or Cloudflare Tunnel on EC2 (no domain).

## Files To Add / Change

### New scripts

| File | Purpose |
|------|---------|
| `scripts/ci.sh` | Local CI: lint, test, e2e (skippable), build, optional env validation. |
| `scripts/production-start.sh` | Neutral production entrypoint: `db:push` then `next start`. Replaces the Railway-named script as the container `CMD`. |
| `scripts/generate-production-env.sh` | Generate `deploy/production.env` from `apps/web/.env.local` + `APP_URL`. |
| `scripts/ec2-bootstrap.sh` | One-time EC2 provisioning (Docker, swap, app dir). |
| `scripts/deploy-ec2.sh` | Local-to-EC2 deploy: CI gate, code sync, compose up, health check. |
| `scripts/install-server-cron.sh` | Install the server crontab from `deploy/crontab.example`. |

### New config / docs

| File | Purpose |
|------|---------|
| `deploy/production.env.example` | Generic production env template (replaces Railway template as the canonical one). |
| `deploy/ec2.env.example` | Deploy connection settings: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `SSH_KEY`, `APP_URL`. |
| `deploy/crontab.example` | Cron schedule mirroring `.github/workflows/cron.yml`, targeting localhost. |
| `deploy/Caddyfile.example` | Reverse-proxy + Let's Encrypt config for a custom domain. |
| `docs/deploy/ec2-production.md` | Full EC2 setup guide. |

### Changes to existing files

- `package.json` — add `"ci"` and `"deploy:ec2"` scripts.
- `Dockerfile` — `CMD` runs `scripts/production-start.sh` (db:push then start).
- `deploy/docker-compose.production.yml` — `web` service uses `production.env`; mount/run start script.
- `scripts/validate-production-env.sh` — reference `deploy/production.env`.
- `scripts/railway-start.sh` — delegate to `scripts/production-start.sh` (kept for legacy).
- `.gitignore` — add `deploy/ec2.env`.
- `docs/deploy/cron-setup.md` — server crontab as Option A (recommended); GitHub Actions as legacy.
- `DEPLOY.md`, `docs/deploy/README.md` — EC2 path first; Railway marked legacy.

## Daily Workflow (after setup)

```bash
# One-time on EC2 (via SSH):
bash scripts/ec2-bootstrap.sh

# One-time on Mac:
bash scripts/generate-production-env.sh https://your-domain.com
# copy deploy/production.env to the server; fill deploy/ec2.env

# Every deploy from Mac:
pnpm deploy:ec2
```

## Out of Scope

- Terraform / CloudFormation infrastructure-as-code (manual EC2 launch for phase 1).
- Any GitHub Actions CI/CD (intentionally removed for deploy; cron workflow kept only as legacy reference).
- Deleting Railway scripts (`scripts/railway-*.sh`, `railway.toml`) — kept as legacy.
- Running the WhatsApp bridge on the same 1 GB instance (optional, documented as a follow-up / separate box).
- Helm APK build changes beyond pointing `EXPO_PUBLIC_API_URL` at the EC2 URL.

## Open Questions

- HTTPS choice (Caddy + domain vs Cloudflare Tunnel) is left to the operator; both are documented. Default recommendation: Cloudflare Tunnel when no domain is configured.
