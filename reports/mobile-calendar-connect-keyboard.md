# Code Review: Mobile Google calendar connect + chat keyboard

**Spec:** `docs/specs/mobile-calendar-connect-keyboard.md`
**Date:** 2026-08-31
**Verdict:** APPROVED WITH NITS
**Detected stack:** next-trpc-monorepo

## Static checks

- Mobile `tsc --noEmit`: PASS
- `pnpm test`: PASS (752 api + 183 web)
- Scoped Playwright: PASS (6)
- `pnpm --filter @ak-system/web build`: PASS
- `pnpm -r run lint`: web `next lint` wants an ESLint config (pre-existing); not treated as a regression from this change

## Spec conformance

- [x] Helm יומן gets חבר יומן Google / חבר חשבון נוסף
- [x] Empty disconnected copy no longer says to sync from a computer
- [x] `calendar.startGoogleOAuth` mutation, Bearer-auth via existing tRPC
- [x] Web Settings OAuth start still uses GET `/api/auth/google-calendar`
- [x] Mobile callback finishes on `helm://calendar`
- [x] `composerLiftPx` is the only chat lift formula; no KeyboardAvoidingView on chat
- [x] Form sheets unchanged (iOS KAV only)

## UI/UX Review

**Verdict:** APPROVED WITH NITS

### Design System Checklist
- [x] Matches Helm tokens (`colors.accent`, 44px min touch)
- [x] RTL layout preserved
- [x] Mobile layout works (calendar card + chat composer)
- [x] No unapproved UI frameworks
- [x] Reuses EmptyState / Card / tRPC helpers

### UX Quality Checklist
- [x] One primary connect action on יומן
- [x] Cognitive load: generic account picker, not hardcoded emails
- [x] Loading / connecting spinner on the connect button
- [x] Error copy in Hebrew
- [x] Touch target ≥ 44px on connect
- [x] `accessibilityLabel` on connect

### Findings
- Must-fix: none in code review
- Nits: Settings screenshot of the Google card is below the fold on desktop; Helm still needs a new APK before the user can use connect or the keyboard fix

## Security

- OAuth still uses the registered HTTPS callback; mobile only changes post-success navigation to `helm://calendar`
- `startGoogleOAuth` is `protectedProcedure` (cookie or Bearer)
- Auth URL is opened in the system browser (`openAuthSessionAsync`); JWT is not put in the query string

## Tests

- OAuth state round-trip + finish URLs
- `startGoogleOAuth` auth gate, invalid hint, mobile state
- `composerLiftPx` covers tab-bar-only shrink (the old >80 heuristic)
- Playwright: simulated keyboard + Settings `חבר` + OAuth start redirect

## Nits

1. Helm calendar connect cannot be confirmed until a new APK is installed.
2. `next lint` remains unconfigured in `apps/web` (pre-existing).
