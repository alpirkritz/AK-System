# Review — bank-scraper-ec2-chrome-deps

**Date:** 2026-08-04  
**Spec:** `docs/specs/bank-scraper-ec2-chrome-deps.md`  
**QA:** `reports/qa-bank-scraper-ec2-chrome-deps.md`

## Verdict

**APPROVED WITH NITS**

Production confirmation of Chromium launch is deferred to post-deploy manual sync (expected; cannot validate missing shared libs from the Mac unit suite).

## Spec conformance

| Criterion | Status |
|-----------|--------|
| Chromium apt deps in `deploy/Dockerfile.runtime` | Met (`libglib2.0-0` + standard Puppeteer set) |
| Same deps in root `Dockerfile` for parity | Met |
| Docker-safe launch args on `realScrape` | Met (`CHROMIUM_LAUNCH_ARGS`) |
| No schema / tRPC / UI scope creep | Met |
| Deploy doc note | Met (`docs/deploy/ec2-production.md`) |

## Diff review

### `deploy/Dockerfile.runtime` / `Dockerfile`

Installs bookworm Chromium shared libraries before pnpm. Correct root cause fix for Code 127 / `libglib-2.0.so.0`. Layer cleans apt lists.

### `packages/api/src/services/bank-sync-service.ts`

Exports `CHROMIUM_LAUNCH_ARGS` and passes them to `createScraper`. Always-on (safe on Mac). Includes `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`.

### Tests

Asserts Docker-safe flags are present. Existing sync tests still green (17/17).

## Nits

1. **Post-deploy verify required:** After `pnpm deploy:ec2`, click "סנכרן עכשיו" on Hapoalim. Success or bank-auth error is fine; Chromium shared-library error must be gone.
2. **Image size / RAM:** Extra apt packages grow the image; sequential scrape policy unchanged. If OOM appears on t3.micro during first sync, that is a separate capacity issue.

## Security

`--no-sandbox` is standard for Chromium-as-root in Docker. Scraper remains read-only (`scrape()` only). No credential handling changes.

## Static checks

- Bank unit tests: pass
- Full monorepo lint/build not re-run for this infra-only change (no web UI / schema). API package has no dedicated lint script.
