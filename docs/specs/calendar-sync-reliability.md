# Calendar Sync Reliability Fix

> **Slug:** `calendar-sync-reliability`
> **Status:** Approved
> **Last Updated:** 2026-07-04

## Goal

Restore reliable Google Calendar sync on EC2 (SQLite-backed tokens) and local dev by prioritizing SQLite over dead Supabase, persisting refreshed OAuth tokens, and running sync on page load.

## User stories

- As a user, I want calendar events to load immediately when I open the calendar, without waiting 15 minutes for the first sync.
- As a user, I want Google tokens to stay valid after access-token expiry without reconnecting OAuth.
- As a user on EC2, I want the app to use SQLite connections even when Supabase URL is misconfigured or unreachable.

## Acceptance criteria

- Given SQLite has active `google_connections`, when `listGoogleConnections` runs, then SQLite rows are returned without requiring a Supabase round-trip.
- Given an expired access token, when calendar events are fetched, then the refresh token is used and the new access token is persisted to SQLite.
- Given Supabase fetch fails (DNS/network), when connections are listed again within 5 minutes, then Supabase is skipped and SQLite is used.
- Given the user opens `/calendar` or `/meetings`, when the page mounts, then `syncFromCalendar` runs once immediately (in addition to the 15-minute interval).
- Given EC2 cron runs, when `/api/cron/calendar-sync` is called with `CRON_SECRET`, then meetings are upserted from Google Calendar for the next 60 days.

## Data model

No schema changes. Updates existing `google_connections.access_token` and `token_expires_at` after OAuth refresh.

## tRPC API

No new procedures. Existing `meetings.syncFromCalendar` and `calendar.events` unchanged.

## UI surface

- `apps/web/src/app/calendar/page.tsx` — run sync on mount.
- `apps/web/src/app/meetings/page.tsx` — run sync on mount.
- `packages/api/src/routers/calendar.ts` — `isConnected` reflects actual Google connections.

## Out of scope

- Removing Supabase integration entirely.
- Per-account disconnect UI.
- Apple Calendar on Linux production.

## Open questions

- None.
