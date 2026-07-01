# Multi Google Accounts (Calendar + Gmail)

> **Slug:** `multi-google-accounts`
> **Status:** Approved
> **Last Updated:** 2026-06-30

## Goal

Connect two Google accounts — `alpirkritz@gmail.com` (personal) and `alpir@daz.guru` (Daz) — so the AK System reads calendars and Gmail from both. Personal is connected first; Daz is added without replacing the first connection.

## User Stories

- As a user, I want to connect my personal Google account so calendar events and Gmail appear in the system.
- As a user, I want to connect my Daz Google account in addition to personal, without losing the first connection.
- As a user, I want to see which accounts are connected and connect more from Settings.

## Acceptance Criteria

- [ ] OAuth callback upserts by `calendar_email`; creates a new Supabase row when none exists (no `no_existing_user` for first connect).
- [ ] `fetchGoogleCalendarEvents` merges events from all active `calendar_connections` rows (not `limit: 1`).
- [ ] `searchGmailMessages` searches all connected accounts and merges results (tagged with `accountEmail`).
- [ ] Composite `calendarId` format `google:{email}:{nativeId}` avoids collisions between accounts.
- [ ] Settings shows connected accounts and buttons to connect personal / Daz / another account.
- [ ] OAuth uses `login_hint` and `prompt=select_account consent` for account picker.
- [ ] `ALLOWED_EMAILS` includes both `alpirkritz@gmail.com` and `alpir@daz.guru`.
- [ ] Vitest covers calendar-id parsing and multi-connection merge helpers.

## Data Model

No local Drizzle change. Tokens remain in Supabase `calendar_connections` (existing Personal Assistant table):

| Column | Notes |
|--------|-------|
| `id` | UUID, generated on insert |
| `user_id` | From OAuth `state` (NextAuth `token.sub`) |
| `provider` | `google` |
| `calendar_email` | Unique per connected Google account |
| `access_token`, `refresh_token`, `token_expires_at` | OAuth tokens |
| `is_active` | `true` when connected |

Env fallback `GOOGLE_CALENDAR_REFRESH_TOKEN` remains as a single synthetic account (`env@local`).

## tRPC API

Extend `calendar` router:

| Procedure | Type | Input | Returns | Auth |
|-----------|------|-------|---------|------|
| `googleAccounts` | query | — | `{ accounts: { email: string; isActive: boolean }[] }` | protected |

## UI Surface

- `apps/web/src/app/settings/page.tsx` — new section "חשבונות Google" with status + connect links.
- `apps/web/src/app/calendar/components/NotConnectedBanner.tsx` — link to Settings connect flow instead of env-only message.
- OAuth entry: `/api/auth/google-calendar?hint=<email>` (optional hint).

## Out of Scope

- Writing to Gmail or calendar (read-only stays).
- Per-account disconnect UI (follow-up).
- Postgres/SQLite local token storage (Supabase only).

## Open Questions

- None — user confirmed both accounts are important; start personal then Daz.
