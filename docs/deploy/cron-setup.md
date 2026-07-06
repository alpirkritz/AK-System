# Cron Jobs (Production)

AK System cron endpoints run scheduled tasks (morning briefing, task reminders, WhatsApp summaries, etc.). They are triggered **on the EC2 instance** — no GitHub Actions, no Railway.

## Setup (EC2 — recommended)

Cron runs on the server itself, calling the local web app at `http://127.0.0.1:3000`.

### First install

1. Deploy the app (see [ec2-production.md](./ec2-production.md)).
2. Ensure `CRON_SECRET` is set in `deploy/production.env` (the generator creates one if missing).
3. On the instance:

```bash
cd /opt/ak-system
bash scripts/install-server-cron.sh
```

Or from your Mac (uses `deploy/ec2.env` for SSH):

```bash
bash scripts/install-server-cron-remote.sh
```

The template is [`deploy/crontab.example`](../../deploy/crontab.example). The installer substitutes `CRON_SECRET` and `APP_URL` (default `http://127.0.0.1:3000`). Verify with `crontab -l`.

`scripts/deploy-ec2.sh` re-installs cron automatically after each deploy.

### Schedule (UTC on Ubuntu)

| Job | Cron (UTC) | Endpoint | Local time (IST, UTC+3) |
|-----|------------|----------|-------------------------|
| Morning briefing | `0 4 * * *` | `/api/cron/morning-briefing` | 07:00 |
| Calendar sync | `*/15 * * * *` | `/api/cron/calendar-sync` | every 15 min |
| Daily meeting summary | `0 17 * * *` | `/api/cron/daily-meeting-summary` | 20:00 |
| Pre-meeting briefing | `*/5 * * * *` | `/api/cron/pre-meeting-briefing` | every 5 min |
| Task reminder | `* * * * *` | `/api/cron/task-reminder` | every minute |
| Feed sync | `0 */6 * * *` | `/api/cron/feed-sync` | every 6 hours |
| WhatsApp group summary | `*/15 * * * *` | `/api/cron/whatsapp-group-summary` | every 15 min |
| ABC agent triggers | `*/15 * * * *` | `/api/cron/agent-triggers` | every 15 min |

Adjust times in `deploy/crontab.example` if your instance timezone differs:

```bash
sudo timedatectl set-timezone Asia/Jerusalem
```

### Timezone for in-app logic

Set `TIMEZONE=Asia/Jerusalem` in `deploy/production.env` so WhatsApp/agent schedules match local time.

## Manual trigger (debug)

From the EC2 instance:

```bash
SECRET=$(grep '^CRON_SECRET=' /opt/ak-system/deploy/production.env | cut -d= -f2-)
curl -s -X POST -H "Authorization: Bearer $SECRET" http://127.0.0.1:3000/api/cron/morning-briefing
```

From your Mac (via public URL):

```bash
export CRON_SECRET=$(grep '^CRON_SECRET=' deploy/production.env | cut -d= -f2-)
export APP_URL=$(grep '^NEXT_PUBLIC_APP_URL=' deploy/production.env | cut -d= -f2-)

curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/morning-briefing"
```

## Security

When `CRON_SECRET` is set, requests without `Authorization: Bearer <CRON_SECRET>` receive **401 Unauthorized**.

Always set `CRON_SECRET` in production — otherwise cron endpoints are publicly callable.

## Legacy: GitHub Actions

[`.github/workflows/cron.yml`](../../.github/workflows/cron.yml) is **disabled** (schedule removed). It previously called a Railway URL via GitHub secrets — that path is no longer used. Do not re-enable unless you have a stable external URL and matching secrets.

## Alternative: cron-job.org

If you cannot use EC2 crontab, use [cron-job.org](https://cron-job.org) with your public HTTPS URL and `Authorization: Bearer <CRON_SECRET>` header.
