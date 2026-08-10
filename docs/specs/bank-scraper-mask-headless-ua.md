# Spec: Bank scraper mask headless UA

## Goal

Fix Otsar HaHayal sync failing with `Waiting for selector #continueBtn failed` on EC2. The Mataf login page serves correctly when the Chrome UA does not contain `HeadlessChrome/`; with the default Puppeteer UA the form (and `#continueBtn`) never appears (Radware / bot gate).

## User stories

- As Alpir, I want Otsar sync to reach the login form on EC2, so `#continueBtn` is found.
- As Alpir, I want the same UA masking applied to all providers (including Hapoalim), so headless detection is less likely to block login.

## Acceptance criteria

- Given `realScrape`, When the scraper page is prepared, Then the User-Agent has `HeadlessChrome/` replaced with `Chrome/` before navigation.
- Given Otsar Mataf login URL from EC2 with that UA, When the page loads, Then `#continueBtn` and `#username` are present (manual/probe verification).
- Given a sync after redeploy, When Otsar runs, Then the error is not `Waiting for selector #continueBtn failed` solely due to headless UA (may still fail on credentials / 2FA / post-login).

## Data model

None.

## tRPC API

None.

## UI surface

None.

## Implementation notes

In `packages/api/src/services/bank-sync-service.ts` `realScrape` / `createScraper` options, set `preparePage` to mask headless UA (same pattern as israeli-bank-scrapers `maskHeadlessUserAgent`). Keep existing Chromium launch args.

## Out of scope

- Full Radware / residential-proxy bypass.
- Upstream URL migration for Otsar beyond what 6.9.0 already has.
- Interactive 2FA for Hapoalim.

## Open questions

None.
