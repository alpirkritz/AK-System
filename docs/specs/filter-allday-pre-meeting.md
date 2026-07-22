# Filter all-day / long events from pre-meeting briefs

> **Slug:** `filter-allday-pre-meeting`
> **Status:** Approved
> **Last Updated:** 2026-07-22
> **Stack:** `next-trpc-monorepo`

## Goal

Stop WhatsApp/Telegram "הכנה לפגישה" notifications for all-day and ≥8-hour calendar blocks (birthdays, WFH, company periods) that currently fire around 02:45 Israel time when Google date-only starts parse as UTC midnight.

## User stories

- As the owner, I want pre-meeting alerts only for real timed meetings so night spam from all-day events stops.
- As the owner, I still want all-day events visible on the calendar UI and usable by morning יועץ יומן context where appropriate.
- As the owner, I want free/busy placeholder filtering to keep working alongside this filter.

## Acceptance criteria

- Given an all-day event (`isAllDay: true` or date-only start without `T`), when `calendar.upcoming` runs, then that event is excluded from the result.
- Given a timed event with duration ≥ 8 hours, when `calendar.upcoming` runs, then that event is excluded.
- Given a timed meeting under 8 hours, when it falls in the 14–16 minute pre-meeting window, then `pre_meeting_briefing` may still send "הכנה לפגישה".
- Given free/busy placeholder titles, when `calendar.upcoming` runs, then they remain excluded (existing behavior).
- Given `calendar.events` / calendar page, when listing events, then all-day and long blocks still appear (no change to `events`).
- Given Vitest, when covering the shared filter + upcoming behavior, then all-day, ≥8h, and short timed cases are asserted.

## Data model

No schema changes.

## tRPC API

Existing router: `packages/api/src/routers/calendar.ts`.

- `upcoming` (`query`) — add filter using shared helper (reuse `isExcludedFromCalendarOptimizer` from `packages/api/src/lib/calendar-filters.ts`, or rename to a neutral shared name such as `isExcludedFromTimedMeetingAlerts` and update calendar-optimizer call sites). Keep free/busy title filter.
- `events` — unchanged.
- Input/output shapes unchanged: `{ limit }` → `{ events, googleErrors }`.

## UI surface

No UI changes. Cron `apps/web/src/app/api/cron/pre-meeting-briefing/route.ts` benefits automatically via `calendar.upcoming`.

## Out of scope

- Disabling `pre_meeting_briefing` entirely
- Changing morning briefing / יועץ יומן presentation
- Filtering by attendee count or calendar source
- Timezone rewrite of how Google date-only starts are stored (filter is sufficient)

## Open questions

None.
