# Calendar Connection Health & Agent Date Fix

> **Slug:** `calendar-connection-health`
> **Status:** Approved
> **Last Updated:** 2026-07-09

## Goal

Fix the case where Settings shows Google "מחובר" but `/calendar` and agents return zero events because OAuth tokens exist in DB but API calls fail silently. Surface real connection health in UI, propagate fetch errors, and align agent date queries with `Asia/Jerusalem`.

## User Stories

- As a user, I want Settings to show whether Google Calendar **actually works**, not only that a token row exists.
- As a user, when tokens are broken I want a clear message and reconnect link on `/calendar`, not an empty grid.
- As a user, I want the calendar advisor to analyze today's events in Israel time.
- As an agent, when Google fetch fails I want the tool result to include errors so I don't report "0 hours" as fact.

## Acceptance Criteria

- [ ] `calendar.googleHealth` returns per-account status: `ok` | `error` with message; probes `calendarList.list`.
- [ ] Settings Google card shows green only when probe succeeds; amber/red with error hint when token row exists but probe fails.
- [ ] `/calendar` shows an error banner when connected accounts exist but today's fetch returns errors and zero Google events.
- [ ] `fetchGoogleCalendarEvents` returns `{ events, errors }` (or equivalent) and logs are preserved; callers merge events as today.
- [ ] Agent tools `get_today_schedule` / `get_week_schedule` use Israel-local `todayIso` and include `calendarErrors` in the payload when present.
- [ ] Vitest covers health probe aggregation and local-date helper.

## Data Model

No schema changes.

## tRPC API

| Procedure | Kind | Return |
|-----------|------|--------|
| `calendar.googleHealth` | query | `{ accounts: { email, status: 'ok' \| 'error', error?: string, calendarCount?: number }[] }` |

Extend `calendar.googleAccounts` optionally — prefer separate health query to avoid slowing every settings load (health on demand + after OAuth).

## UI Surface

- `apps/web/src/app/settings/page.tsx` — GoogleAccountsCard: probe status per account, reconnect CTA on error.
- `apps/web/src/app/calendar/page.tsx` + new `CalendarFetchErrorBanner` — show when fetch errors present.
- `apps/web/src/app/calendar/components/NotConnectedBanner.tsx` — unchanged for no connections.

## Out of Scope

- Replacing Google with CalDAV/Microsoft Graph.
- Notion meetings as primary calendar source.
- Auto token refresh UI beyond reconnect link.

## Open Questions

- None.
