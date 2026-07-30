# Mobile local dev login (no Google)

> **Slug:** `mobile-local-dev-login`
> **Status:** Approved (user selected: local login button, no Google)
> **Last Updated:** 2026-07-13

## Goal

Allow previewing Helm against a local Next.js backend without Google OAuth. Production continues to require Google sign-in only.

## User Stories

- As a developer, I want a **כניסה לוקאלית** button on the Helm login screen in `__DEV__` so I can browse chat/tasks/etc against `localhost` without Google.
- As an owner, I want production builds to **never** expose this bypass.

## Acceptance Criteria

- [ ] `POST /api/auth/mobile/dev` exists and returns `{ accessToken, user }` only when `NODE_ENV === 'development'`; otherwise `404`.
- [ ] Token is a real mobile JWT via `createMobileAccessToken` for `dev@local` / Developer.
- [ ] Helm login shows **כניסה לוקאלית** when `__DEV__` is true; Google remains the only option outside `__DEV__`.
- [ ] Local `.env` points `EXPO_PUBLIC_API_URL` at the local backend (`http://localhost:3000` for same-machine web preview).
- [ ] Dev API responses allow CORS from Expo web (`localhost:8081`) so browser preview can call the API.
- [ ] Production / non-dev builds do not show the local button and the endpoint is unavailable.

## Data Model

None.

## tRPC API

None. REST only:

| Route | Method | Auth | Notes |
|-------|--------|------|-------|
| `/api/auth/mobile/dev` | POST | none | Body empty; gated by `NODE_ENV === 'development'` |

## UI Surface

- `apps/mobile/app/login.tsx` — add secondary **כניסה לוקאלית** button under Google (dev only).
- `apps/mobile/lib/api.ts` — `signInLocalDev()` helper calling the new endpoint.

## Out of Scope

- Changing production Google OAuth
- Mock/offline UI without backend
- Expo Go LAN IP auto-discovery beyond documenting that phones need `http://<LAN-IP>:3000`

## Open Questions

None — approved via user choice (dev bypass button).
