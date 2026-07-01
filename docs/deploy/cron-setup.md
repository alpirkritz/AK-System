# Cron Jobs (Production)

AK System cron endpoints run scheduled tasks (morning briefing, task reminders, etc.). They need an external trigger. On EC2 the recommended approach is the instance's own `crontab` — no external CI/CD.

## Option A: Server crontab on EC2 (recommended)

Runs on the instance itself, calling the local web app. No GitHub Actions required.

### Setup

1. Deploy the app (see [ec2-production.md](./ec2-production.md)).
2. Ensure `CRON_SECRET` is set in `deploy/production.env` (the generator creates one if missing).
3. On the instance, install the crontab:

```bash
cd /opt/ak-system
bash scripts/install-server-cron.sh   # uses http://127.0.0.1:3000 by default
```

The template is [`deploy/crontab.example`](../../deploy/crontab.example); the installer substitutes
`CRON_SECRET` and the target URL. Verify with `crontab -l`.

### Timezone

Cron times in the template are UTC (Ubuntu default). To use local time:

```bash
sudo timedatectl set-timezone Asia/Jerusalem
```

Then adjust the hour-based jobs in `deploy/crontab.example` and re-run the installer.

## Option B: GitHub Actions (legacy)

Workflow: [`.github/workflows/cron.yml`](../../.github/workflows/cron.yml)

### Setup

1. Deploy web app to Railway and note the URL (e.g. `https://ak-system.up.railway.app`).
2. Generate a secret: `openssl rand -base64 32`
3. Set **the same value** in:
   - Railway variable: `CRON_SECRET`
   - GitHub repo → **Settings → Secrets and variables → Actions**:
     - `CRON_SECRET` — the bearer token
     - `APP_URL` — `https://ak-system.up.railway.app` (no trailing slash)

4. Push to `main` — the workflow runs on schedule automatically.

### Schedule (Israel time, UTC in workflow)

| Job | Cron (UTC) | Endpoint | Local time (IST, UTC+3) |
|-----|------------|----------|-------------------------|
| Morning briefing | `0 4 * * *` | `/api/cron/morning-briefing` | 07:00 |
| Daily meeting summary | `0 17 * * *` | `/api/cron/daily-meeting-summary` | 20:00 |
| Pre-meeting briefing | `*/5 * * * *` | `/api/cron/pre-meeting-briefing` | every 5 min |
| Task reminder | `* * * * *` | `/api/cron/task-reminder` | every minute |
| Feed sync | `0 */6 * * *` | `/api/cron/feed-sync` | every 6 hours |
| WhatsApp group summary | `*/15 * * * *` | `/api/cron/whatsapp-group-summary` | every 15 min |
| ABC agent triggers (full LLM) | `*/15 * * * *` | `/api/cron/agent-triggers` | every 15 min (per-agent schedule in `/agents`) |

Adjust cron expressions in `.github/workflows/cron.yml` if your `TIMEZONE` differs.

### Manual trigger

GitHub → **Actions** → **Production Cron** → **Run workflow**.

## Option C: cron-job.org

1. Create account at [cron-job.org](https://cron-job.org)
2. For each endpoint, create a job:
   - URL: `https://<domain>/api/cron/morning-briefing`
   - Method: GET or POST
   - Header: `Authorization: Bearer <CRON_SECRET>`
   - Schedule: as above

## Security

When `CRON_SECRET` is set, requests without `Authorization: Bearer <CRON_SECRET>` receive **401 Unauthorized**.

Always set `CRON_SECRET` in production — otherwise cron endpoints are publicly callable.

## Verify

```bash
export CRON_SECRET=your-secret
export APP_URL=https://your-app.up.railway.app

curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/morning-briefing"
```

Expected: JSON response with `ok: true` or task-specific payload (not 401).
