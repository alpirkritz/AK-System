# QA — bank-scraper-chrome-eagain

**Date:** 2026-08-28  
**Spec:** `docs/specs/bank-scraper-chrome-eagain.md`

## Suite

| Check | Result |
|-------|--------|
| `pnpm --filter @ak-system/api exec vitest run src/services/bank-chrome-launch.test.ts src/services/bank-sync-service.test.ts` | Pass (21 tests) |
| `pnpm test` (API + web unit) | Pass |
| Playwright `apps/web/e2e/bank-accounts.spec.ts` | Not re-run — no UI flow change; existing modal/empty-state coverage still applies |
| Full `pnpm e2e` | Skipped — Chrome spawn EAGAIN is an EC2/Docker runtime failure; Playwright on Mac cannot reproduce `/root/.cache/puppeteer` spawn |

## Spec criteria (test signal)

| Criterion | How verified |
|----------|----------------|
| Low-process Chromium flags | Unit: `CHROMIUM_LAUNCH_ARGS` contains `--no-zygote`, `--renderer-process-limit=1` |
| Scrape mutex | Unit: overlapping `withScrapeLock` / `syncConnection` maxInFlight = 1 |
| Retry on EAGAIN | Unit: thrown launch error retried 3 times then success; outcome-style launch failure retried |
| Hebrew error | Unit: thrown spawn EAGAIN stored as `BROWSER_LAUNCH_HEBREW_ERROR`, type `GENERIC` |
| Bank-side errors unchanged | Unit: `INVALID_PASSWORD` / `הסיסמה שגויה` not retried / not rewritten |
| kill stray no-op on macOS | Unit: does not throw |
| compose `init` + `shm_size` | Static review of `deploy/docker-compose.production.yml` |

## Residual risk

Live EC2 confirmation is required after `pnpm deploy:ec2` (compose recreate). If a single Chrome still cannot fork on the 1 GB box, next step is `--single-process` or a larger instance (out of scope).
