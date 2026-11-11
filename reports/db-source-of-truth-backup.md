# Review: db-source-of-truth-backup

> **Spec:** `docs/specs/db-source-of-truth-backup.md`
> **Date:** 2026-10-29
> **Verdict:** **CHANGES REQUESTED** — one blocking item (e2e baseline), see below. Code itself has no known defects.

## What was checked

| Check | Result |
|---|---|
| `pnpm -r run lint` | pass (pre-existing a11y warnings only) |
| Vitest (api + web) | **pass** — 1395 api + 307 web; 7 new tests (`notion-local-wins`, `backup-runs`) |
| `pnpm --filter @ak-system/web build` (`AK_DEPLOY_BUILD=1`) | **pass**, `/api/cron/backup-report` present |
| Playwright e2e | **36 failed / 102 passed** — see blocking item |
| `db:push` after app bootstrap (the prod container boot path) | pass: push → bootstrap → push reports "No changes detected" |
| Backup scripts | `bash -n` on all; exercised locally with stand-ins for `age`/`rclone`/`flock`/`curl` (see below) |

## Defects found and fixed during review

- **Deploy-blocking:** the bootstrap DDL for `notion_field_baselines` and `backup_runs` declared `id TEXT PRIMARY KEY` while drizzle expects `NOT NULL`. `drizzle-kit push` (run by the Dockerfile on container start, after bootstrap) then tried to recreate the table and failed with "index … already exists". Fixed in `packages/database/src/index.ts`; verified with the push/bootstrap/push sequence.
- `updateFromNotion` threw "No values to set" when every incoming field was locally overridden and no extra fields were passed (caught by the new unit test). Fixed.

## Blocking item

**36 e2e failures are not verified against a clean baseline.** They span areas this change does not touch (Slack settings, trading journal, project page, meeting analysis, notion-note meetings — the latter with `SqliteError: FOREIGN KEY constraint failed` in e2e seeding code). Re-running slack-settings, trading-journal and task-assignee in isolation still failed, and the page snapshot renders normally (no crash). Only `TaskModal` and `/settings` were touched in the UI, and neither is exercised by the Slack or trading specs, so these look pre-existing — but that is an inference, not a measurement. To clear: run the same e2e suite on the commit before this change (e.g. a throwaway worktree) and confirm the same 36 fail, or fix them.

## Nits / non-blocking

- Cleanup script is named `audio-cleanup-monthly.sh`; the spec says `audio-monthly-cleanup.sh`. Rename the spec or the script.
- Audio and cleanup reports store a human summary in the `error` column of `backup_runs`; acceptable, but a dedicated `note` column would be cleaner.
- "Local wins" cannot tell apart a local edit made *before* the first sync after deploy from Notion's value: with no baseline yet, the first sync adopts Notion's value (same as the old behavior). Edits made after the first post-deploy sync are protected.
- Local-wins relies on comparing stored values, so a user setting a field back to Notion's old value looks like "untouched" (harmless).
- `typecheck`: the repo has many pre-existing sqlite/pg union-type errors (e.g. `person-external-ids.ts`), so `tsc` is not a usable gate; new code follows the same `Db = ReturnType<typeof getDb>` pattern.

## Not verified (cannot be, locally)

- Real `age` encryption/decryption, any `rclone` call (upload, `lsjson`, `deletefile`, `lsf`), docker volume resolution and container stop/start in restore, `crontab` installation, the `deploy-ec2.sh` changes (syntax-checked only), Google OAuth consent screen in **In production** mode.
- The acceptance criterion "restore drill executed once and recorded" is **open** until the one-time setup in `docs/deploy/backup-and-restore.md` is done on the EC2 box.

## Production rollout risk

First deploy: `backup.age.pub` / `rclone.conf` do not exist on EC2 yet, so the pre-deploy snapshot and backup cron install are skipped with a warning; the DB migration (two new tables, additive) runs without a snapshot. Take a manual copy of the `web-data` volume first, or complete the backup setup before deploying.

## Addendum 2026-11-01 — public legal pages (`docs/specs/public-legal-pages.md`)

Needed so the `AK System Backup` OAuth consent screen can be set to *In production* (otherwise the Drive token expires after 7 days). Added `/about` and `/privacy` (public, static), `lib/public-paths.ts` + middleware allowlist, bare layout for those paths. Vitest (2) and Playwright (2) pass; lint clean for touched files (one pre-existing `<img>` warning). Not verified: prod middleware behaviour logged-out (dev mode skips auth; helper unit-tested only) — verify with `curl` after deploy. Google may reject `ngrok-free.dev` as an authorized domain or the ngrok interstitial may block its check; fallback is GitHub Pages.

## Addendum 2026-11-01 (2) — live setup and restore drill

Drive access: new Google Cloud project `ak-system-backup` (consent screen In production, scope `drive.file`, Desktop OAuth client, legal pages on GitHub Pages). rclone token sees only `AK_system_backups`. age keypair: private key `~/.ak-backup/backup.key` (Mac only), public key on EC2.

Verified live: first DB backup (11.7 MB) uploaded and `verify-backup.sh` from Drive on the Mac **PASSED** (sha256, integrity_check ok, row counts match). First audio backup uploaded (122 files, 1.5 GiB). Cron installed; dead-man endpoint returns ok. `audio-cleanup-monthly.sh --dry-run` selects 2 of 3 recordings older than 30 days.

Defects found and fixed during setup: `backup-daily.sh` reported kind `daily` but the API only accepts `db` (reports were silently rejected, dead-man would alert falsely); `install-backup-cron.sh` had unescaped nested quotes in the dead-man cron line.

Still open: no Telegram configured on the server (alerts only logged); EC2 rclone is v1.53 (works, old); EBS weekly snapshots (AWS DLM) not set up; disk 80% full; e2e baseline still unverified; ~50 stray `_tmp_*` files were rsynced to `/opt/ak-system`.
