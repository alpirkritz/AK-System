# Bank captcha handoff

> **Slug:** `bank-captcha-handoff`
> **Status:** Approved
> **Last Updated:** 2026-10-05

## Goal

Otsar HaHayal sync from EC2 is blocked before the accounts page. A fresh browser gets a Radware check instead of the login form. A saved browser profile can already show the login form, but the scraper's click on `#continueBtn` often does nothing, and the following wait is reported as an SMS code even though no code was sent. While a bot check is on screen, and again after the password is submitted, show the scraper page inside Finance → Accounts and relay the user's own clicks. Hide password field values in that image. When a real OTP screen is detected, show the existing code field. Nothing solves the check automatically.

This stays on the existing `israeli-bank-scrapers` login. It is not an official open-banking API.

## User Stories

- As Alpir, I want a live view of the bank security check during an EC2 sync, so I can solve it myself and the sync can continue.
- As Alpir, I want that view to close as soon as the login form is visible, so the password is not shown in the panel.
- As Alpir, I want a timeout that does not claim an SMS was sent when the bank never reached that step.

## Acceptance Criteria

- [ ] Given a scrape page whose title or URL contains Radware, perfdrive, or hCaptcha, or whose text says the activity looks automated, When the login form is not present, Then the connection status becomes `awaiting_captcha`.
- [ ] Given status `awaiting_captcha`, When the Accounts tab is open, Then it shows a screenshot of the scraper page and sends clicks back in viewport coordinates.
- [ ] Given the login form is visible and the post-login handoff has not started, When a frame or click is requested, Then no image is returned and no click is sent.
- [ ] Given the password was submitted and the accounts page is not showing, When the Accounts tab is open, Then the same panel shows the bank page, with password values blanked, and clicks are relayed.
- [ ] Given the user does not finish the check before `#continueBtn` times out, or the post-login wait ends without an OTP screen, When the error is stored, Then it is not `OTP_REQUIRED` and it does not claim an SMS was sent.
- [ ] Given no captcha session, When `captchaFrame` or `captchaClick` is called, Then the call does not throw and does not report a delivered click.

## Data Model

Add `awaiting_captcha` to `BANK_CONNECTION_STATUSES` in both `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`. `status` stays a free `text` column. No new table and no migration SQL.

## tRPC API

Both procedures are `protectedProcedure` on `finance.bankConnections`.

- `captchaFrame` — input `{ id: string }`. Returns `{ image: string; width: number; height: number } | null`. `image` is a JPEG base64 of the current viewport, only while the bot-check session is active.
- `captchaClick` — input `{ id: string; x: number; y: number }`. Returns `{ ok: true }` when a click was delivered, `{ ok: false }` otherwise.

## UI Surface

`apps/web/src/app/finance/AccountsTab.tsx`. When a connection's status is `awaiting_captcha`, show a panel under that card (same placement as the OTP panel): Hebrew explanation, a polled image, clicks mapped from the displayed image to the screenshot pixels. The page stays RTL; click coordinates use the image element's physical box. Poll the connection list while this status is set. Disable "סנכרן עכשיו" for that card while the panel is open.

## Out of Scope

- Automatic captcha solving, third-party solver APIs, or proxy rotation.
- Official Israeli open-banking integration.
- VNC or a second browser on the laptop.
- Showing the password value in the handoff image. Password inputs are cleared for the screenshot and restored afterward.

## Open Questions

None.
