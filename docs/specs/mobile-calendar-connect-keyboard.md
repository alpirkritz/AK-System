# Mobile Google calendar connect + chat keyboard

> **Slug:** `mobile-calendar-connect-keyboard`
> **Status:** Approved (user asked why the APK cannot connect calendars, and required the keyboard-covers-composer bug to be verified before claiming a fix)
> **Detected stack:** `next-trpc-monorepo` (Helm Expo APK + existing web OAuth)

## Goal

Give Helm a way to connect Google calendars on the phone, and keep the עוזר composer fully visible above the keyboard without stacking two keyboard-avoidance mechanisms.

## User stories

- As a Helm user, I want to connect a Google account from the יומן screen so I do not have to use the website.
- As a Helm user with no calendars connected, I want a clear "חבר יומן Google" action instead of "סנכרן מהמחשב".
- As a Helm user adding a second Google account, I want the Google account picker (same as web).
- As a Helm user typing in עוזר, I want the input and שלח fully visible above the keyboard.
- As a maintainer, I want one keyboard-lift formula so resize-mode, tab-bar hide, and manual padding do not fight each other.

## Acceptance criteria

- Given Helm יומן with no Google connections, When the screen loads, Then a primary action "חבר יומן Google" is visible and the empty hint does not say to sync from a computer.
- Given Helm יומן, When I tap חבר יומן Google, Then the app opens the existing Google Calendar OAuth consent (account picker) and, on success, returns to יומן showing the connected email.
- Given Helm יומן with at least one connected account, When the screen loads, Then each connected email is listed and "חבר חשבון נוסף" remains available.
- Given `/api/auth/google-calendar` on web, When I connect from Settings, Then behavior is unchanged (redirect to `/settings?google_connected=1`).
- Given Helm עוזר, When the keyboard opens and the tab bar hides (~50–80px window shrink) without a full `adjustResize`, Then the composer is lifted by `keyboardHeight - windowShrink` (not zero).
- Given Helm עוזר, When Android `adjustResize` shrinks the window by the full keyboard height, Then extra lift is 0 (no double padding).
- Given the chat keyboard logic, When searching the mobile app, Then there is a single helper `composerLiftPx` and chat does not also wrap in `KeyboardAvoidingView`.

## Data model

None. Existing `google_connections` / Supabase `calendar_connections` rows are reused.

## tRPC API

Router file: `packages/api/src/routers/calendar.ts` (existing).

New procedure:

- `startGoogleOAuth` — `mutation`
  - Zod input: `{ hint?: string (email), returnTo: 'web' | 'mobile' }` (`returnTo` default `'web'`)
  - Returns: `{ authUrl: string }`
  - Auth: `protectedProcedure` (NextAuth cookie or Helm Bearer JWT)
  - Builds the same Google auth URL as `GET /api/auth/google-calendar`, with OAuth `state` encoding `{ userId, returnTo }`.

Existing (unchanged, consumed by Helm):

- `googleAccounts` — `query` — `{ accounts: { email, isActive }[] }`
- `googleHealth` — `query` — `{ accounts: { email, status, error? }[] }`

OAuth callback `GET /api/auth/google-calendar/callback`: if `state.returnTo === 'mobile'`, finish on `helm://calendar?...` (HTML landing that navigates to the scheme) instead of `/settings`. Web `returnTo` stays `/settings`.

## UI surface

- `apps/mobile/app/calendar.tsx` — connection card (status + חבר / חבר חשבון נוסף); empty state CTA when disconnected.
- `apps/mobile/lib/data.ts` — thin tRPC wrappers for accounts, health, `startGoogleOAuth`.
- `apps/mobile/app/(tabs)/chat.tsx` — use `composerLiftPx` only; no `KeyboardAvoidingView` on this screen.
- `apps/mobile/lib/composer-keyboard.ts` — single lift formula (unit-tested).
- `apps/web/src/app/settings/page.tsx` — unchanged connect links.
- Form sheets keep `KeyboardAvoidingView` on iOS only; they are not chat and must not copy chat's keyboard listeners.

### Microcopy

- Connect: `חבר יומן Google` / `חבר חשבון נוסף`
- Empty disconnected: `אין יומן מחובר` / `חבר חשבון Google כדי לראות אירועים`
- Empty connected: `אין אירועים בטווח שנבחר`
- Success: `חשבון {email} חובר`
- Error: `שגיאת חיבור ליומן` + human reason when known
- Status: `פעיל` / `שגיאת חיבור`

## Out of scope

- `react-native-keyboard-controller`.
- Changing Android `softwareKeyboardLayoutMode` (form sheets rely on `resize`).
- Disconnect/revoke from Helm.
- Hardcoded personal/daz email rows on mobile (web Settings keeps those; Helm uses a generic account picker).
- iOS TestFlight.

## Open questions

None.
