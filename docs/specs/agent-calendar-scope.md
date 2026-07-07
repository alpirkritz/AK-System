# Agent Calendar Scope

> **Slug:** `agent-calendar-scope`
> **Status:** Approved
> **Last Updated:** 2026-07-05

## Goal

לאפשר למשתמש לסמן ב-UI אילו יומנים (כולל תתי-יומנים) הסוכנים — הוגו, אופטי, cron — יתייחסו אליהם בלבד, עם שמירה ב-DB שעובדת בכל הערוצים.

## User Stories

- As a user, I want to mark which calendars Hugo and Opti should look at, so they ignore other calendars.
- As a user, I want to see sub-calendars (e.g. dragontail under alpirkritz@gmail.com) even when they have no events in the next 14 days.
- As a user, I want the selection to persist across deploys and work on WhatsApp and web chat.
- As a user, I want the default behavior unchanged until I configure a scope (all calendars).

## Acceptance Criteria

- Given connected calendars, When I open Settings → "יומנים לסוכנים", Then I see a list grouped by account/source with sub-calendars.
- Given I selected only dragontail and Daz calendars, When I ask "מה יש לי היום", Then the answer includes events only from those calendars.
- Given I never changed the setting, When an agent queries the calendar, Then behavior matches today (all calendars).
- Given at least one calendar is selected, When `get_calendar_conflicts` runs, Then overlap detection is limited to selected calendars.
- Given I saved a selection, When deploy / WhatsApp / morning-briefing cron runs, Then the same scope applies.

## Data Model

New table `user_settings` in `packages/database/src/schema.ts` and `schema.pg.ts`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Always `'default'` |
| `agentCalendarIds` | text (JSON) | `string[]` or stored as `null` — `null` means all calendars |
| `updatedAt` | text | ISO timestamp |

Additive migration only (`db:push`).

## tRPC API

**New router:** `packages/api/src/routers/settings.ts`

| Procedure | Kind | Input | Return | Auth |
|-----------|------|-------|--------|------|
| `settings.agentCalendars.get` | query | — | `{ calendarIds: string[] \| null }` | protected |
| `settings.agentCalendars.set` | mutation | `{ calendarIds: z.array(z.string()).nullable() }` | `{ calendarIds: string[] \| null }` | protected |

**Extend** `packages/api/src/routers/calendar.ts`:

| Procedure | Kind | Input | Return | Auth |
|-----------|------|-------|--------|------|
| `calendar.catalog` | query | — | `{ calendars: { id, name, color, source, accountEmail? }[] }` | protected |

`catalog` uses Google `calendarList.list` per connected account (all sub-calendars). Apple/Exchange calendars are derived from events in a 90-day window.

## UI Surface

- `apps/web/src/app/settings/page.tsx` — new section **"יומנים לסוכנים"** after the Hugo memory link.
- Reuse `CalendarCheckboxList`; data from `calendar.catalog`; save via `settings.agentCalendars.set`.
- Selection semantics: `null` when all checked; partial array when filtered.

## Out of Scope

- Merging with `CONFLICT_CALENDARS` or `SYNC_CALENDARS` (localStorage, different purposes).
- Filtering `/calendar` page sidebar (session-local).
- Full Apple calendar catalog without events.
- Per-account disconnect UI.

## Open Questions

- None.
