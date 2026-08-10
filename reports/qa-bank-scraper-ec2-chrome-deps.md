# QA — bank-scraper-ec2-chrome-deps

**Date:** 2026-08-04  
**Spec:** `docs/specs/bank-scraper-ec2-chrome-deps.md`

## Scope tested

- Unit: `packages/api/src/services/bank-sync-service.test.ts` (includes new `CHROMIUM_LAUNCH_ARGS` assertion)
- Unit: `packages/api/src/routers/finance.bank.test.ts`

## Results

| Suite | Result |
|-------|--------|
| bank-sync-service.test.ts | 10/10 passed |
| finance.bank.test.ts | 7/7 passed |

## Not run (by design)

- Full `pnpm e2e` — no UI change; Chromium shared-lib failure is EC2-image-only.
- Live Hapoalim scrape on EC2 — requires `pnpm deploy:ec2` after this change, then manual "סנכרן עכשיו".

## Verdict

**PASS** for local unit coverage of the code change. Production Chromium launch must be verified after redeploy.
