# Bank scraper Chrome launch EAGAIN on EC2

> **Slug:** `bank-scraper-chrome-eagain`
> **Status:** Implemented
> **Last Updated:** 2026-08-28

## Goal

Finance → Accounts sync on the 1 GB EC2 Docker box fails before any bank login with:

`Failed to launch the browser process: spawn /root/.cache/puppeteer/chrome/.../chrome EAGAIN`

`EAGAIN` here is Node failing to `spawn` Puppeteer’s Chrome (process/memory pressure, leftover Chromium, or zombies after a previous scrape/OTP). The user should be able to connect/sync a bank or card account without seeing a Puppeteer traceback. A Hebrew message is shown only if launch still fails after retries.

## User Stories

- As Alpir, I want “סנכרן עכשיו” / first connection sync to launch Chrome on EC2, so I can log in and import balances instead of an English spawn error.
- As Alpir, I want a second sync (or another account) to wait until the current Chromium scrape finishes, so two browsers never run together on the 1 GB box.
- As Alpir, if Chrome still cannot start, I want a short Hebrew explanation — not a Puppeteer path dump.

## Acceptance Criteria

- [ ] Given Docker Compose production, When the `web` service starts, Then it uses `init: true` (zombie reaping) and `shm_size` of at least `256mb`.
- [ ] Given `realScrape`, When Chromium is launched, Then args include the existing Docker-safe flags plus `--no-zygote` (and other low-process flags listed in Implementation notes).
- [ ] Given two overlapping `syncConnection` calls (user click + cron, or two accounts), When both run in the same Node process, Then the second waits until the first scrape (including OTP wait) fully finishes — never two Chromiums at once.
- [ ] Given stale Chromium `SingletonLock` files after reboot/OOM, When scrape starts, Then those lock files are removed so Chrome can reuse the trusted-device profile (not Code 21).
- [ ] Given `spawn ... chrome EAGAIN` or `Failed to launch the browser process`, When scrape fails, Then it retries up to 2 more times with backoff; if still failing, `lastError` is Hebrew (no `/root/.cache/puppeteer` path).
- [ ] Given Vitest with an injected `ScrapeFn`, When tests run on macOS, Then no real Chrome is launched and kill-stray is a no-op.
- [ ] Given invalid bank password after Chrome launches, When scrape returns a bank-side error, Then that error is stored unchanged (not replaced by the launch Hebrew message).

## Data Model

No schema changes. `schema.ts` / `schema.pg.ts` untouched.

`bank_connections.last_error` / `last_error_type` already store scrape failures. Launch failures keep `lastErrorType` `GENERIC` (or existing `UNKNOWN_ERROR` on throw mapped after humanize). No new status values.

## tRPC API

No new procedures. Existing:

- `finance.bankConnections.sync` `{ id }`
- `finance.bankConnections.syncAll`
- cron `apps/web/src/app/api/cron/bank-sync/route.ts`

All go through `syncConnection` / `syncAllConnections` in `packages/api/src/services/bank-sync-service.ts`. Auth unchanged (`protectedProcedure`).

## UI Surface

No new routes or layout. `/finance` Accounts tab (`apps/web/src/app/finance/AccountsTab.tsx`) already shows `שגיאה: ${res.error}` and the card `lastError` banner.

Copy change is **backend-only**: replace the English Puppeteer dump with:

> לא הצלחנו לפתוח דפדפן לסנכרון הבנק (השרת עמוס או חסר זיכרון). נסה שוב בעוד כמה שניות.

No `.btn` / `.input` / RTL changes.

## Implementation notes

1. **`packages/api/src/services/bank-sync-service.ts`**
   - Extend `CHROMIUM_LAUNCH_ARGS` with `--no-zygote`, `--disable-extensions`, `--disable-background-networking`, `--renderer-process-limit=1`.
   - Process-wide scrape mutex around the scrape call in `syncConnection`.
   - Before launch (Linux only): kill leftover processes whose cmdline contains `puppeteer/chrome` (do not use `pkill` — `procps` may be missing on `bookworm-slim`; scan `/proc`).
   - Retry scrape on browser-launch failure (EAGAIN / Failed to launch) up to 3 attempts total.
   - `humanizeScrapeError()` for stored/returned `error`.
2. **`deploy/docker-compose.production.yml`**: `init: true` and `shm_size: '256mb'` on `web`.
3. **`docs/deploy/ec2-production.md`**: one sentence that bank Chrome needs compose `init` + shm (zombie/EAGAIN).
4. Redeploy (`pnpm deploy:ec2`) required for compose + image; code-only rsync is not enough for `init`/`shm_size`.

## Out of Scope

- Upgrading the EC2 instance size.
- Switching to Browserless / remote Chrome / a separate scraper worker.
- Installing distro `chromium` instead of Puppeteer’s bundled Chrome 148.
- `--single-process` (can break CDP / bank iframes; only add if mutex + `--no-zygote` + init still EAGAIN).
- Bank 2FA / portal URL / credential bugs unrelated to Chrome spawn.
- Changing OTP UI or trusted-device profiles.

## Open Questions

None — proceed. If after deploy a single Chrome still cannot spawn, revisit `--single-process` or instance size as a follow-up.
