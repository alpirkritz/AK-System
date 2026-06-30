# Code Review: Mobile App as Primary Interface + Cross-Channel Push

> **Slug:** `mobile-app-notifications`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-06-29

## Spec Conformance

All acceptance criteria from [docs/specs/mobile-app-notifications.md](../docs/specs/mobile-app-notifications.md) are met:

- Single `sendBrowserPush` helper in [apps/web/src/lib/web-push.ts](../apps/web/src/lib/web-push.ts) reused everywhere.
- `pushAssistantMessage` (all cron jobs) now sends Web Push + Telegram + WhatsApp.
- `notifyAgentRunComplete` sends Web Push for every channel (not only `web`).
- Hugo's WhatsApp reply mirrored to Web Push (`/chat` deep link).
- FOMO/keyword alerts and group summaries send Web Push.
- Deep links route correctly (chat/agent/FOMO).
- Google sign-in enforced in production via middleware; email allowlist in `auth.ts`.
- Webhook/cron/auth API routes and SW/manifest/icons bypass the auth redirect (matcher excludes `api`).
- `/settings` notifications card (enable + test) with permission state.
- `/chat` is the PWA `start_url`, a primary bottom-nav tab, and polls for pushed messages.
- Folded/unfolded layout: single-column + bottom nav (narrow); centered max-width content (wide).
- Cloudflare Tunnel + `pnpm serve` production script + VAPID documented.

No schema changes (reused `push_subscriptions`) — parity not required.

## Static Checks

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/api run test` (Vitest) | PASS — 14/14 (incl. 7 new push tests) |
| `pnpm --filter @ak-system/web build` | PASS — 37/37 routes, middleware compiled |
| `pnpm -r run lint` | N/A — `apps/web` `next lint` is uninitialized (pre-existing, prompts interactively); bridge `tsc` PASS; no new TS/lint errors on changed files |

## Findings

### Must-fix
- None.

### Should-fix
- None.

### Nits
- `apps/web` has no committed ESLint config, so `next lint` cannot run non-interactively. Pre-existing; out of scope here but worth initializing later.
- E2E push cannot be exercised end-to-end under `pnpm dev` (Serwist SW disabled in dev); the Playwright specs assert UI presence and folded/unfolded rendering only. Real push verification is a manual device step (see QA checklist below).

## Security Review

- Auth re-enabled in production (`middleware.ts`); only API routes with their own Bearer/secret auth bypass the redirect; `/api/trpc` still gated by `protectedProcedure`.
- Sign-in restricted to `ALLOWED_EMAILS`; empty list documented as "any account" (only safe behind a non-public URL).
- No secrets committed; VAPID/tunnel values are env-only with `.example` placeholders.
- `SKIP_AUTH_IN_PRODUCTION` escape hatch retained but defaults off.

## QA — Manual Device Checklist (Fold 7)

1. `pnpm serve` on the Mac; open the tunnel HTTPS URL on the phone; sign in with Google.
2. Install PWA ("Add to Home screen"); confirm it opens to `/chat`.
3. Settings → "הפעל נוטיפיקציות" → grant; "שלח בדיקה" → OS notification appears; tap opens `/chat`.
4. Trigger a cron/FOMO/agent event → push arrives; WhatsApp still receives in parallel.
5. Verify folded (cover) single-column and unfolded (tablet) centered layout; fold/unfold mid-chat keeps state.

## Suggested PR Description

Turn the PWA into the primary phone interface: route all notifications (FOMO, cron briefs, agent completions, Hugo replies, group summaries) through Web Push in addition to WhatsApp/Telegram; re-enable Google auth with an email allowlist; make `/chat` the PWA start surface with folded/unfolded (Fold 7) layouts and message polling; add a Cloudflare Tunnel production run script and VAPID/env docs.
