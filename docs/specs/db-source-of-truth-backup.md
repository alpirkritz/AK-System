# DB Source of Truth + Daily Encrypted Backup to Google Drive

> **Slug:** `db-source-of-truth-backup`
> **Status:** Approved
> **Last Updated:** 2026-10-29

## Goal

Make AK System the owner's source of truth. Two parts:

1. **Local edits win over Notion.** Notion keeps flowing *in* (new/changed pages are still imported), but fields the user edited in AK System are no longer overwritten by the 10-minute Notion sync.
2. **Strong, verified, daily backup** of everything stateful on the EC2 box (1GB RAM) to a single Google Drive folder, encrypted, with retention, restore drill, and failure alerting. SQLite stays; no Postgres migration.

## Decisions already made

- Stay on SQLite (WAL). ~6.5MB today; Postgres would cost 150–300MB RAM on a 1GB box for no benefit.
- Live DB stays on EC2 local disk (docker volume `web-data` → `/data/ak_system.sqlite`). Drive is a backup target only, never a live path. Dev DB must also live outside the Drive-synced folder.
- Drive access: personal Google account via OAuth, restricted to one pre-defined folder.
- Notion continues to import; AK System wins on conflict.

## User stories

- As the owner, I want my edits to tasks (and other Notion-sourced entities) to survive the next Notion sync.
- As the owner, I want a daily encrypted copy of all my data in a Drive folder, so losing the EC2 instance loses at most a day.
- As the owner, I want to be told on Telegram if a backup fails *or silently doesn't run*.
- As the owner, I want a one-command restore I have actually tested.

## Part A — Local edits win over Notion

Current behavior (`packages/api/src/services/notion-tasks-sync.ts` ~L1250): for an existing task, every sync run overwrites `title, dueDate, priority, status, done, assigneeId, projectId, workspaceId, …` from Notion. Any local edit is lost within 10 minutes.

New behavior:

- **Implemented design:** table `notion_field_baselines` (entity, entity_id, field, baseline_value) stores the last value imported from Notion. A field whose current local value differs from its baseline is a local edit and the sync skips it (no per-mutation tracking needed; if Notion converges to the local value, the field is re-synced). Other fields keep updating from Notion; new Notion pages are created as before.
- Same mechanism for **every entity the Notion sync updates** (people, meetings, projects, companies, …): each gets `locally_edited_fields`, and the sync skips overridden fields everywhere.
- UI: small indicator on a task when it has local overrides, plus a "reset to Notion value" action per field (sets the baseline to the current value; next sync restores Notion's value).
- Out of scope: writing changes back *to* Notion (one-way inbound stays).

## Part B — Backup system

### What is backed up (EC2 docker volumes)

| Volume | Contents | Included |
|---|---|---|
| `web-data` | `ak_system.sqlite` | yes (daily snapshot archive) |
| `web-data` | voice recordings dir (audio) | yes, **separately** — see "Audio" below |
| `abc-data` | live-edited agent markdown (`/data/abc`) | yes |
| `bridge-config` | WhatsApp bridge config | yes |
| `bridge-auth` | WhatsApp linked-device session keys | **no** (decided: only data is needed; re-pair QR after a restore) |

### Audio (voice recordings)

Audio is large and immutable, so it is NOT packed into every daily archive (that would store ~42 copies). Instead:

- Each recording file is age-encrypted once and uploaded once to `AK_system_backups/audio/` (`rclone copy`, skips what's already there). The DB snapshot records which audio files exist.
- **Monthly cleanup script** (`scripts/audio-monthly-cleanup.sh`, cron on the 1st): deletes local audio files on EC2 older than the retention window, **only after verifying** each file has an uploaded copy on Drive (size + checksum match). Transcripts/analysis stay in the DB untouched. Dry-run mode and a Telegram summary ("deleted N files, freed X MB").
- Whether the Drive copies of audio are also deleted is an open question (see below).

### Snapshot procedure (daily, EC2 host cron, e.g. 01:00 UTC)

1. `sqlite3 /data/ak_system.sqlite "VACUUM INTO '<tmp>/ak_system-YYYY-MM-DD.sqlite'"` — consistent snapshot while app is running (never `cp` the live file).
2. `PRAGMA integrity_check` on the snapshot; abort + alert if not `ok`. Also compare row counts of key tables against the previous snapshot; alert on a drop > 20 % (catches accidental mass-delete).
3. Tar the other volumes' files, then compress the whole set.
4. Encrypt with **age** using a **public key stored on the server**. The private key lives only with the owner (password manager + printed copy). The server cannot decrypt its own backups; EC2 loss does not lose the key.
5. Keep the last 7 encrypted archives locally on EC2 (`/opt/ak-backups`), upload the new one to Drive with `rclone copy`.
6. Prune on Drive: 14 daily + 8 weekly + 12 monthly.
7. Memory: all steps are streaming/low-memory; run under `nice`/`ionice`; no Node process involved.

### Google Drive access (OAuth, folder-scoped)

- Use **rclone** (Drive backend) installed on the EC2 host, with the owner's **own OAuth client** (Google Cloud project, Drive API enabled) and scope **`drive.file`**.
- `drive.file` limits the token to files/folders the app itself created. rclone creates the folder `AK_system_backups` on first run and can touch nothing else in the Drive. (Trade-off: this scope cannot target a folder that already exists and was created by hand. If the owner insists on a pre-existing folder, the alternative is the broad `drive` scope + `root_folder_id`, which is a weaker boundary — not recommended.)
- **Gotcha:** an OAuth client left in "Testing" mode has refresh tokens that **expire after 7 days**. The OAuth consent screen must be set to **In production** (unverified is fine for a single personal user; `drive.file` is a non-sensitive scope) so the token does not expire.
- rclone config (token) lives in `/opt/ak-system/rclone.conf`, chmod 600, not committed, not in the Docker image.
- Backups are age-encrypted before upload, so Drive only ever sees ciphertext.

### Monitoring

- Each run writes a row to a new `backup_runs` table via a small authenticated cron-endpoint call (`/api/cron/backup-report`, `CRON_SECRET`): `startedAt, finishedAt, status, sizeBytes, sha256, driveFileId, error`.
- On failure: Telegram alert immediately.
- **Dead-man's switch:** existing `/api/cron/scheduled-agents` (or a dedicated check) alerts if there is no successful `backup_runs` row in the last 26 h — covers cron not running, host down, token revoked.
- Settings page shows last successful backup time and size.

### Restore

- `scripts/restore-backup.sh <archive>`: downloads (or takes local file), decrypts with the owner's private key, verifies `integrity_check`, stops the web container, swaps DB into the volume (keeping the old one as `.pre-restore`), restarts.
- **Restore drill:** `scripts/verify-backup.sh` restores the latest backup into a temp dir (on the Mac, with the private key) and runs sanity queries. Documented to run monthly; acceptance requires it was run once successfully before this feature is called done.

### Extra safety hooks

- `scripts/deploy-ec2.sh` takes a snapshot (local, unencrypted-temp → encrypted) *before* `docker compose up`, so a bad deploy/migration is reversible.
- **Weekly EBS snapshot** (AWS) as a second, independent layer (approved). Keep the last 4; documented in `docs/deploy/backup-and-restore.md` (AWS CLI/DLM lifecycle policy, ~pennies/month for a small volume).

## Acceptance criteria

- Given a task edited locally (e.g. status), when the Notion sync runs, then that field keeps the local value while other fields still update from Notion.
- Given "reset to Notion value", when the next sync runs, then the field takes Notion's value and is no longer marked overridden.
- Given the daily cron runs, then an age-encrypted archive appears in the Drive folder `AK_system_backups` with the date in its name, and a `backup_runs` row with status `ok`.
- Given the archive is decrypted with the owner's private key, then `PRAGMA integrity_check` returns `ok` and row counts match the source snapshot.
- Given the server holds only the public key, then the server cannot decrypt any archive.
- Given the rclone token, then it can list/create/delete only files created by the app (verified by attempting to list another Drive folder → not visible).
- Given the backup fails or no successful backup exists for 26 h, then a Telegram alert is sent.
- Given 30+ days of runs, then Drive holds ≈ 14 daily + 8 weekly + 12 monthly archives, not more.
- Given `scripts/restore-backup.sh`, then a fresh container started from a restored archive serves the same data (drill executed once and recorded in `reports/`).
- Backup run keeps EC2 memory use below ~150MB peak and does not cause the web container to be OOM-killed.

## Data model changes

Both `packages/database/src/schema.pg.ts` and `schema.ts` (+ SQLite bootstrap block in `database/src/index.ts`):

- New table `notion_field_baselines` (entity, entity_id, field, baseline_value, updated_at; unique per entity+field).
- New table `backup_runs`: `id, started_at, finished_at, status ('ok'|'failed'), size_bytes, sha256, drive_file_id, error`.

## tRPC / API

- `notionOverrides.get({entity,id})` lists locally edited fields; no change to existing mutations.
- `notionOverrides.reset({entity,id,field})`: lets the next sync overwrite that field.
- `backup.status` (query): latest run + last success; used by Settings.
- `POST /api/cron/backup-report`: bearer `CRON_SECRET`; called by the host script to record a run; triggers Telegram alert on failure.

## UI surface

- Task row/modal: override badge + per-field "reset to Notion" (RTL, existing `.btn` classes; UI Designer review required).
- Settings: "Backup" card (last success, size, status).

## Scripts / infra

- `scripts/backup-daily.sh` (host), `scripts/restore-backup.sh`, `scripts/verify-backup.sh`, `scripts/install-backup-cron.sh` (hooked into `deploy-ec2.sh`, same pattern as `install-server-cron.sh`), `docs/deploy/backup-and-restore.md` with the one-time rclone + OAuth + age key setup.

## Out of scope

- Postgres migration; live replication (Litestream) — could be a later upgrade for near-zero RPO.
- Writing local changes back to Notion.
- Backing up Notion/Google data themselves.
- Moving the dev SQLite file out of the Drive-synced folder is recommended and trivial (`DATABASE_PATH` in `.env.local`) but handled as a separate one-line change.

## Open questions

Resolved: `bridge-auth` excluded; local-wins applies to all entities; EBS weekly included; audio backed up.

Also resolved: retention 14 daily + 8 weekly + 12 monthly confirmed. Audio is deleted from **both EC2 and Drive**, only when the recording's analysis is complete **and** it is older than 30 days (audio has no value to the owner after that; transcripts/analysis stay in the DB). The cleanup first ensures the Drive copy exists/verified only for the "not yet deleted" window; after the 30-day mark both copies are removed.

No open questions remain.

## Part C — Backup alerts go to the in-app notification system (added 2026-11-01)

**Why:** no Telegram is configured on the server, so failure and dead-man alerts were only logged. The owner wants them in the app's own notifications.

- `/api/cron/backup-report` replaces the Telegram alert with: `createNotification({ type: 'system', title: 'גיבוי נכשל' | 'הגיבוי היומי לא רץ', body, url: '/settings' })` + browser push + mobile push (the same senders `pushAssistantMessage` uses). It does **not** use `pushAssistantMessage` (that writes a chat message and fans out to WhatsApp/Telegram).
- Telegram stays as an optional extra: still sent if `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_CHAT_ID` are set.
- **Throttle:** the dead-man check runs hourly, so it raises at most one notification per 12 h while the problem persists (look up the latest `system` notification with the same title). A failed run notifies every time.
- Tests: Vitest for the throttle helper (no repeat within 12 h, repeats after).
- Out of scope: per-type notification preferences UI entry for backups.
