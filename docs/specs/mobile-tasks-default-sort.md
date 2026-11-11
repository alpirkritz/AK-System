# Mobile tasks default sort

**Slug:** `mobile-tasks-default-sort`

## Goal

Show task lists in the mobile app in the same order as the web tasks page default: high priority first, then nearest due date. Tasks with no due date stay last inside their priority.

## User stories

- As the owner, I want the mobile tasks list to open in the web default order, so I see urgent work first.
- As the owner, I want the home task strip and a project's task list to use that same order, so the three surfaces agree.
- As the owner, I want a missing due date to sink to the bottom of its priority, so undated work does not jump ahead of dated work.

## Acceptance criteria

- Given tasks of mixed priority, when any mobile task list renders, then order is high, then medium, then low. Unknown priority ranks as medium.
- Given two tasks with the same priority, when the list renders, then the earlier due day (first 10 characters, `YYYY-MM-DD`) comes first.
- Given a task with no parseable due day, when the list renders, then it comes after dated tasks of the same priority.
- Given the open, overdue, done, cancelled, and all filters, and a workspace or search filter, when the list renders, then the remaining rows stay in that order.
- Given the home dashboard task window and a project screen, when those lists render, then they use the same comparator.

## Data model

No schema change in `packages/database/src/schema.ts` or `schema.pg.ts`.

## tRPC API

No API change. `tasks.list` may keep returning rows by `createdAt`. The mobile client sorts after fetch.

## UI surface

- `apps/mobile/app/(tabs)/tasks.tsx` — sort the filtered list.
- `apps/mobile/app/(tabs)/index.tsx` — sort the home task window.
- `apps/mobile/app/project/[id].tsx` — sort the project task list.
- Shared comparator in `apps/mobile/lib/sort-tasks.ts`.

Web `apps/web` is unchanged. Its tasks-page fallback is already `{ primary: 'priority_high', thenBy: 'due_asc' }`.

## Out of scope

- Sort controls, saved preferences, or grouping headers on mobile.
- Changing the web sort or the API `orderBy`.
- Building a new APK.

## Open questions

None.
