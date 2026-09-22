# UX flow and comfort

> **Slug:** `ux-flow-comfort`
> **Status:** Approved (user asked to implement the prior UX proposals, excluding color)
> **Last Updated:** 2026-09-22

## Goal

Make each home-screen action open the thing its label names, use one Hebrew name per destination, and let task and meeting lists be readable before optional filters.

## User stories

- As the owner, I want "משימה חדשה" on the web dashboard to open the new-task form, so I do not land on a list instead.
- As the owner, I want "פגישה חדשה" on the web dashboard to open the new-meeting form.
- As the owner, I want the web dashboard counts for open tasks, overdue tasks, and calendar events to open those lists.
- As the owner, I want a due date, and the word "באיחור" when it is past, on dashboard and task rows.
- As the owner, I want `/tasks?status=overdue` to show only overdue open tasks, with a visible "באיחור" chip.
- As the owner, I want project, meeting, and source filters behind "סינון", while status chips, search, and sort stay in front of the list.
- As the owner, I want the phone "פגישות" count to open that same date window, with a way back to all upcoming meetings.
- As the owner, I want the phone task section and its setting to use the same description of what the list contains.
- As the owner, I want יומן, סוכנים, זיכרון, and סביבות עבודה named the same way, and the phone-width web bar to match the app tabs.

## Acceptance criteria

- Given the web dashboard, when the owner activates "משימה חדשה", then the task modal opens on the dashboard.
- Given the web dashboard, when the owner activates "פגישה חדשה", then `/meetings?new=1` opens the meeting modal and the query is removed.
- Given overdue open tasks, when the owner opens the overdue count or `/tasks?status=overdue`, then only those tasks show and the "באיחור" chip is selected.
- Given a dashboard task with a past due date, when the row renders, then it shows "באיחור" and the date.
- Given the tasks page, when no project, meeting, or source filter is set, then those controls are behind "סינון"; status chips, search, and sort stay visible.
- Given the phone dashboard meeting window, when the owner taps the meetings count, then the meetings tab shows only that window and "הצג הכל" clears it.
- Given task window "today", the section title and the settings row both read "היום, באיחור, ובלי תאריך".
- Web sidebar says "יומן", includes "סוכנים" and "זיכרון", and the narrow bottom bar is דשבורד, פגישות, משימות, עוזר, עוד. Phone settings say "סביבות עבודה".

## Data model

No schema changes in `packages/database/src/schema.ts` or `schema.pg.ts`.

## tRPC API

No router changes.

## UI surface

- `apps/web/src/app/page.tsx`, `apps/web/src/app/tasks/page.tsx`, `apps/web/src/app/meetings/page.tsx`, `apps/web/src/app/calendar/page.tsx`
- `apps/web/src/components/DashboardLayout.tsx`, `apps/web/src/app/globals.css` (chip tap height)
- `apps/web/src/lib/task-due.ts`
- `apps/mobile/app/(tabs)/index.tsx`, `meetings.tsx`, `more.tsx`, `settings/dashboard.tsx`, `app/_layout.tsx`
- `apps/mobile/lib/dashboard-window.ts`, `apps/mobile/components/FilterChips.tsx`
- Playwright: `apps/web/e2e/task-workspaces.spec.ts` opens "סינון" before the source chips

## Out of scope

- Recoloring status, priority, or KPI numbers.
- Changing which tasks the "today" window includes.
- Adding a People tab on the native app, or removing People from the desktop sidebar.
- Hiding search or sort behind "סינון".

## Open questions

None.
