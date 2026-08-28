# Review — bank-scraper-chrome-eagain

**Date:** 2026-08-28  
**Spec:** `docs/specs/bank-scraper-chrome-eagain.md`  
**QA:** `reports/qa-bank-scraper-chrome-eagain.md`

## Verdict

**APPROVED WITH NITS** — code and compose match the spec; production confirmation needs a deploy (`init`/`shm_size` only apply after compose recreate).

## Spec conformance

| Criterion | Status |
|-----------|--------|
| `init: true` + `shm_size: '256mb'` on `web` | Met |
| `--no-zygote` and extra low-process flags | Met |
| Process-wide scrape mutex (including OTP wait) | Met (`withScrapeLock` around scrape in `syncConnection`) |
| Kill stray Puppeteer Chrome on Linux before launch | Met (`/proc` scan; no `pkill`) |
| Retry launch failures up to 3 attempts | Met (`scrapeWithBrowserLaunchRetry`) |
| Hebrew `lastError` for spawn EAGAIN | Met |
| Bank-side errors not rewritten | Met |
| No schema / tRPC / UI layout changes | Met |
| `--single-process` not added | Met (explicitly out of scope) |

## Diff review

### `packages/api/src/services/bank-chrome-launch.ts`

Helpers isolated from the scrape/DB loop. Mutex queues overlapping syncs. Retry covers both thrown `puppeteer.launch` errors and `{ success: false, errorMessage }` launch outcomes. Kill-stray is Linux-only and matches `puppeteer/chrome` cmdline only.

### `packages/api/src/services/bank-sync-service.ts`

`realScrape` still only calls `scrape()`. Launch retry is inside `realScrape`; the mutex wraps the injected `ScrapeFn` as well so cron + UI cannot double-launch. Humanize runs on both throw and unsuccessful outcome.

### `deploy/docker-compose.production.yml`

`init: true` reaps zombie Chrome (nproc/EAGAIN). `shm_size: '256mb'` is belt-and-suspenders with `--disable-dev-shm-usage`.

## UI Review

**Verdict:** APPROVED (N/A for layout)

No `apps/web` component, class, or RTL change. Accounts tab already shows `lastError`. Backend Hebrew copy is a single sentence, no jargon, no PII.

### Checklist

- [x] RTL unchanged
- [x] Dark theme / design-system classes untouched
- [x] Error copy is Hebrew and actionable
- [x] No new modal/flow

## Nits

1. **Must redeploy** with compose up (not rsync-only) so `init`/`shm_size` take effect.
2. **Post-deploy:** click סנכרן עכשיו. Expect bank login/OTP or a Hebrew memory message — not a `/root/.cache/puppeteer` path.
3. `next lint` is interactive in this repo (no ESLint config); not a regression from this change. Full web build not re-run (no frontend code).

## Security

Kill-stray only targets `puppeteer/chrome` cmdlines, not the Node process. Scraper remains read-only. Credentials encryption unchanged. `--no-sandbox` already present from the prior Chrome-deps fix.
