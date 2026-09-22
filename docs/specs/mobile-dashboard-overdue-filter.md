# Mobile dashboard — overdue tasks open a filtered list

> **Slug:** `mobile-dashboard-overdue-filter`
> **Status:** Approved (user asked to implement the diagnosed navigation bug)
> **Last Updated:** 2026-09-22

## Goal

Tapping the dashboard "באיחור" count opens the tasks tab showing only open tasks whose due date is before today, with the screen stating that filter. Tapping "משימות פתוחות" opens the same tab on the open filter.

## User stories

- As the owner, I want tapping "באיחור" on the dashboard to show those overdue tasks, so the number I tapped matches the list I land on.
- As the owner, I want the tasks screen to say "משימות באיחור" and keep a "באיחור" chip selected, so I know where I am and can switch back.
- As the owner, I want "משימות פתוחות" to land on all open tasks, so the two cards do not share one destination.
- As the owner, I want an overdue row to say "באיחור" next to its date, so the list uses the same word as the dashboard.

## Acceptance criteria

- Given open tasks with a due date before today, when the owner taps the dashboard "באיחור" card, then the tasks tab shows only those tasks.
- Given the owner taps "משימות פתוחות", when the tasks tab opens, then the filter is "פתוחות" and overdue tasks are not the only rows.
- Given the overdue filter is active, when the list renders, then the header title is "משימות באיחור", the "באיחור" chip is selected, and each row with a past due date shows "באיחור" before the date.
- Given there are no overdue open tasks, when the overdue filter is active, then the empty state reads "אין משימות באיחור".
- Given the owner selects another chip, when the list updates, then the filter stays on that chip and is not forced back to overdue.
- The overdue rule is one function used by the dashboard count and the tasks list: not done, status not `done` or `cancelled`, due date (first 10 chars) strictly before the local calendar today.

## Data model

No schema changes in `packages/database/src/schema.ts` or `schema.pg.ts`.

## tRPC API

No router changes. The mobile app already loads tasks through the existing tasks list.

## UI surface

- `apps/mobile/app/(tabs)/index.tsx` — overdue card navigates to `/tasks` with `filter=overdue`; open-tasks card navigates with `filter=open`.
- `apps/mobile/app/(tabs)/tasks.tsx` — read `filter`, add a "באיחור" chip, header title, empty copy, overdue date label.
- `apps/mobile/lib/task-due.ts` — shared `todayKey`, `dueDay`, `isOverdueOpenTask`.
- `apps/mobile/components/KpiCard.tsx` — optional `accessibilityLabel` so the card announces "משימות באיחור".

Web `/tasks` and the web dashboard are unchanged in this change.

## Out of scope

- Adding an overdue entry point on the web dashboard or web `/tasks`.
- Changing which tasks the dashboard "היום" window includes (undated tasks stay in that section).
- Restyling the navy/turquoise system, nav IA, or other screens.
- Push, cron, or reminder logic.

## Open questions

None.
