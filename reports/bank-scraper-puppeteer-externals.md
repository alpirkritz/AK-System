# Review — bank-scraper-puppeteer-externals

**Date:** 2026-08-04  
**Spec:** `docs/specs/bank-scraper-puppeteer-externals.md`

## Verdict

**APPROVED WITH NITS** — deployed to EC2; manual sync confirmation still needed from Alpir.

## Diagnosis

Both Hapoalim and Otsar HaHayal stored `last_error = e.mask is not a function` with `last_error_type = UNKNOWN_ERROR`. That type is only set when `scrape()` **throws** (our catch), which happens when Puppeteer fails in scraper `initialize()` (browser launch / CDP WebSocket) — outside the library's login try/catch.

Standalone `puppeteer.launch` inside the container worked. The failure path is Next.js webpack interfering with `ws` / optional `bufferutil` (`bufferUtil.mask` → reported as `e.mask`).

## Changes

- Externalize `israeli-bank-scrapers`, `puppeteer`, `puppeteer-core`, `ws` in `apps/web/next.config.js`
- `WS_NO_BUFFER_UTIL=1` / `WS_NO_UTF_8_VALIDATE=1` in Dockerfiles + compose + `production.env.example`
- Redeployed via `SKIP_CI=1 pnpm deploy:ec2`

## Nit

Confirm with "סנכרן עכשיו" — expect bank-side result (timeout / invalid password / success), not `e.mask`.
