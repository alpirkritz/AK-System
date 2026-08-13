# Dashboard open tasks: open TaskModal + sortable list

> **Slug:** `dashboard-task-open-sort`
> **Status:** Approved
> **Last Updated:** 2026-08-13

## Goal

On the dashboard open-tasks list, clicking a task opens the existing `TaskModal` with full details for edit. The list also exposes a sort dropdown (preference persisted in localStorage) so the owner can order open work by due date, priority, recency, or status.

## User Stories

- As the owner, I want to click an open task on the dashboard so I can view/edit details without navigating to `/tasks`.
- As the owner, I want to choose how the dashboard open-tasks list is sorted, and have that choice remembered in the browser.

## Acceptance Criteria

- [ ] Clicking the task title (not the checkbox) opens `TaskModal` with `editingTaskId` set to that task.
- [ ] Checkbox still toggles done via `tasks.toggleDone` without opening the modal.
- [ ] Closing the modal returns to the dashboard; `tasks.list` is invalidated on close.
- [ ] Task rows show due date when present (same pattern as `/tasks`).
- [ ] Sort `<select>` appears next to the “משימות פתוחות” heading (before “הכל”), with `aria-label="מיון משימות"`.
- [ ] Sort options: `due_asc` (default), `due_desc`, `priority`, `created_desc`, `status`.
- [ ] Preference persisted at `localStorage` key `ak:dashboard-tasks-sort` (`LS.DASHBOARD_TASKS_SORT`).
- [ ] Missing due dates sort last for due-date modes; tie-break: `due_asc` then `id`.
- [ ] Only open tasks (`done === false`) are listed (unchanged).

## Data Model

None.

## tRPC API

None. Reuse existing:
- `tasks.list`
- `tasks.toggleDone`
- `tasks.getById` / related (via `TaskModal`)
- `people.list`, `meetings.list`, `projects.list`, `workspaces.list` (for modal props)

## UI Surface

- `apps/web/src/app/page.tsx` — open TaskModal on title click; sort select; due date in row
- `apps/web/src/lib/sort-tasks.ts` — `DashboardTaskSort` + `sortDashboardTasks`
- `apps/web/src/lib/ls-keys.ts` — `DASHBOARD_TASKS_SORT`
- Reuse `TaskModal` (dynamic import, `ssr: false`) as on `/tasks`

## Out of Scope

- Sort controls on `/tasks` page or settings
- Limiting how many open tasks appear on the dashboard
- Deep-linking / browser back for the modal

## Open Questions

None.
