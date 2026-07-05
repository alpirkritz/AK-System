# Filter Free/Busy Placeholders from Pre-Meeting Notifications

> **Slug:** `filter-free-busy-pre-meeting`
> **Status:** Approved
> **Last Updated:** 2026-07-05

## Goal

Stop "הכנה לפגישה" push notifications for Google Calendar cross-calendar visibility placeholders (`פנוי`, `לא פנוי`, `free`, `busy`, etc.) while keeping those blocks visible on the calendar UI.

## User Stories

- As a user, I do not want a pre-meeting briefing notification 15 minutes before a "לא פנוי" or "Busy" block from another calendar.
- As a user, I still want to see free/busy blocks on the calendar screen.

## Acceptance Criteria

- [ ] `calendar.upcoming` excludes events whose title matches a free/busy placeholder (Hebrew exact; English case-insensitive).
- [ ] Placeholder titles filtered: `פנוי`, `לא פנוי`, `free`, `busy`, `tentative` (any casing for English).
- [ ] `POST /api/cron/pre-meeting-briefing` does not send notifications for placeholder events in the 15-minute window.
- [ ] `calendar.events` is unchanged — calendar UI still shows placeholders.
- [ ] `meetings.purgeFreeBusy` and `meetings.syncFromCalendar` use the shared title list (DRY).
- [ ] Vitest covers `isFreeBusyPlaceholderTitle` for Hebrew, English, trim, and real meeting titles.

## Data Model

No schema changes.

## tRPC API

No new procedures. Extend behavior of existing `calendar.upcoming` filter in [`packages/api/src/routers/calendar.ts`](../packages/api/src/routers/calendar.ts).

New shared helper: [`packages/api/src/lib/calendar-filters.ts`](../packages/api/src/lib/calendar-filters.ts).

## UI Surface

No UI changes. Cron route [`apps/web/src/app/api/cron/pre-meeting-briefing/route.ts`](../apps/web/src/app/api/cron/pre-meeting-briefing/route.ts) benefits automatically via `calendar.upcoming`.

## Out of Scope

- Filtering placeholders from morning briefing (`calendar.events`).
- Hiding placeholders on the calendar page.
- Filtering by calendar source or attendee count.

## Open Questions

- None.
