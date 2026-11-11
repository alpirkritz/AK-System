# Public About + Privacy pages (for Google OAuth consent screen)

> **Slug:** `public-legal-pages`
> **Status:** Draft — awaiting approval
> **Last Updated:** 2026-11-01

## Goal

Google requires a public homepage URL and privacy-policy URL before an OAuth app can be switched from *Testing* to *In production*. Without that, the Drive backup's refresh token expires every 7 days. Serve two minimal, public, static pages from the existing app domain so the `AK System Backup` consent screen can be published. No cost, no new domain.

## User stories

- As the owner, I want public `/about` and `/privacy` pages so Google accepts my consent screen and the Drive token stops expiring.

## Acceptance criteria

- `GET /about` and `GET /privacy` return 200 **without a session** (no redirect to `/login`) in production.
- Pages are static, server-rendered, no tRPC calls, no user data, no cookies.
- `/privacy` states truthfully: single-user private tool; the Drive backup uses scope `drive.file` only; it writes only encrypted (age) archives to a folder it created; no data is shared with third parties; contact email.
- `/about` describes the app in two or three sentences and links to `/privacy`.
- No other route becomes public (middleware allowlist limited to these two paths).
- Hebrew-first copy with an English paragraph (Google reviewers read English).

## Data model changes

None (`schema.pg.ts` / `schema.ts` untouched).

## tRPC API

None.

## UI surface

- `apps/web/src/app/about/page.tsx`, `apps/web/src/app/privacy/page.tsx` — plain layout, existing design-system classes, RTL, dark theme. Minimal; UI Designer pass limited to RTL/dark check.
- `apps/web/src/middleware.ts`: add `/about` and `/privacy` to the unauthenticated pass-through, next to `/helm.apk`.

## Rollout

1. Deploy (requires explicit approval — production).
2. Verify both URLs from a logged-out client.
3. In Google Cloud project `ak-system-backup`: Branding → homepage `…/about`, privacy `…/privacy`, authorized domain `ngrok-free.dev` (fallback: GitHub Pages if Google rejects it or the ngrok interstitial blocks the check) → Publish app.

## Tests

- Vitest: middleware lets `/about` and `/privacy` through without a session and still redirects another page.
- Playwright: both pages render logged out.

## Out of scope

- Terms of service, cookie banner, Google OAuth verification (not needed for `drive.file`, a non-sensitive scope).
- Any in-app Drive connect UI.

## Open questions

- Contact email on the privacy page: `alpirkritz@gmail.com`? (assumed)
