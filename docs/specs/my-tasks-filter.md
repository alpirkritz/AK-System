# My tasks filter

> **Slug:** `my-tasks-filter`
> **Status:** Approved
> **Last Updated:** 2026-10-08

## Goal

The task list and the home "what I need to do" widgets include every synced task, including ones assigned to other known people. The owner needs a clear way to see only tasks assigned to him, without stopping the sync from pulling other people's tasks.

## User Stories

- As the owner, I want `/tasks` and the mobile tasks screen to open on my tasks, so I immediately see what I have to do.
- As the owner, I want a "כולם" control next to it, so I can still see tasks assigned to other people.
- As the owner, I want the web and mobile home counts and previews to count only my open tasks.
- As the owner, I want a task with no assignee, or an assignee who is someone else, to stay out of "שלי".

## Acceptance Criteria

- [ ] Given tasks assigned to the owner, to someone else, and to nobody, when `/tasks` loads, then only the owner's tasks are listed and the "שלי" chip is pressed.
- [ ] Given that list, when the owner presses "כולם", then every task is listed and the URL is `/tasks?owner=all`.
- [ ] Given `owner=all` is absent or any other value, the list stays on the owner's tasks.
- [ ] Given the web dashboard, the open-task count, overdue count, and preview list include only tasks whose `assigneeId` is `people.me`.
- [ ] Given the mobile tasks screen, "שלי" is the default and "כולם" shows every task.
- [ ] Given the mobile home screen, the open and overdue counts and the task preview include only the owner's tasks.
- [ ] A task the owner only appears on as a related person, not as `assigneeId`, stays out of "שלי".

## Data Model

None.

## tRPC API

None. Clients use the existing `people.me` query and `tasks.assigneeId` from `tasks.list`.

## UI Surface

- `apps/web/src/app/tasks/page.tsx` — chip group "סינון לפי אחראי" with "שלי" (default) and "כולם". "כולם" sets `?owner=all`. Empty copy tells the owner that other people's tasks are under "כולם".
- `apps/web/src/app/page.tsx` — dashboard open-task KPI, overdue link, and preview use only the owner's tasks. Heading: "המשימות שלי".
- `apps/mobile/app/(tabs)/tasks.tsx` — same two chips, default "שלי".
- `apps/mobile/app/(tabs)/index.tsx` — home counts and preview use only the owner's tasks. KPI label: "המשימות שלי".

Meeting and project task lists stay unfiltered. They show the work of that meeting or project.

## Out of Scope

- Changing which tasks Notion sync imports.
- Filtering by related people (`task_people`) instead of `assigneeId`.
- Remembering the "כולם" choice across visits.

## Open Questions

None.
