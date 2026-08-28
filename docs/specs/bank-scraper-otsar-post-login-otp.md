# Spec: Otsar post-login OTP + selector timeout humanization

> **Slug:** `bank-scraper-otsar-post-login-otp`
> **Status:** Draft
> **Last Updated:** 2026-08-28

## Goal

Fix Otsar HaHayal sync failing with `Waiting for selector #card-header failed (GENERIC)` on EC2. Login reaches `#continueBtn` (UA mask works) but the packaged `waitForPostLogin` races on post-login selectors with a long timeout and never handles an intermediate SMS/OTP screen. Extend OTP detection for Fibi/Mataf banks, patch `waitForPostLogin` to poll for OTP + post-login, and surface clearer Hebrew errors when login does not complete.

## User stories

- As Alpir, I want Otsar sync to pause for SMS OTP when the bank asks after password login, so I can enter the code in Finance → Accounts.
- As Alpir, I want a clear Hebrew message when post-login times out, not a raw Puppeteer selector string.
- As Alpir, I want Visa Cal and other providers unchanged.

## Acceptance criteria

- [ ] Given Otsar sync after password submit, When the bank shows an SMS/OTP screen, Then `status` becomes `awaiting_otp` and the user can submit a code via the existing UI.
- [ ] Given OTP is submitted while scrape waits, When the bank accepts the code, Then sync proceeds past `#card-header` / account dashboard.
- [ ] Given post-login selectors never appear and no OTP is detected, When scrape fails, Then `last_error` is a Hebrew message explaining possible OTP/login timeout (not raw `#card-header`).
- [ ] Given `humanizeScrapeError`, When message is `Waiting for selector \`#card-header\` failed`, Then a Hebrew OTP/login hint is returned.
- [ ] Given unit tests for OTP heuristics and humanization, When run, Then they pass without Chromium.

## Data model

None.

## tRPC API

None (reuse `finance.bankConnections.submitOtp` and `sync`).

## UI surface

None (existing `awaiting_otp` OTP form on Accounts tab).

## Implementation notes

1. `packages/api/src/services/bank-beinleumi-post-login.ts` — patch `israeli-bank-scrapers` `waitForPostLogin` at runtime for `otsarHahayal`; loop: detect OTP → `waitForOtp` → fill → retry short post-login wait.
2. `packages/api/src/services/bank-otp-page.ts` — Fibi/Mataf OTP heuristics (body copy + `#otp`-style inputs) even when login fields remain in DOM.
3. `packages/api/src/services/bank-chrome-launch.ts` — `humanizeScrapeError` maps selector-timeout / post-login failures to Hebrew.
4. Wire patch in `realScrape` before `createScraper` when provider is `otsarHahayal`.

## Out of scope

- Upgrading `israeli-bank-scrapers` version.
- Hapoalim-specific post-login changes (separate redirect-wait patch already exists).
- Headed browser / VNC.

## Open questions

None.
