# Person drawer task list: sort + open TaskModal

> **Slug:** `person-tasks-sort-open`
> **Status:** Approved
> **Last Updated:** 2026-08-12

## Goal

In the person detail drawer task list, open tasks appear first (oldest due date first within each group), and clicking a task opens `TaskModal` so the owner can edit and close back to the drawer.

## User Stories

- As the owner, I want open tasks at the top sorted oldest→newest so overdue/open work is visible first.
- As the owner, I want clicking a task to open the task editor and close it to return to the person drawer.

## Acceptance Criteria

- [ ] Person drawer tasks: `done === false` before `done === true`; within each group sort by `dueDate` ascending (null/missing last).
- [ ] Clicking the task title/row (not the checkbox) opens `TaskModal` with `editingTaskId`.
- [ ] Closing the modal leaves the person drawer open.
- [ ] Checkbox still toggles done without opening the modal.
- [ ] Same sort applied on project detail task list for consistency.
- [ ] Project detail already opens TaskModal — no change required beyond sort.

## Data Model

None.

## tRPC API

None required. Optional client-side sort is enough.

## UI Surface

- `apps/web/src/components/people/PersonDetailDrawer.tsx` — sort + TaskModal
- `apps/web/src/app/projects/[id]/page.tsx` — sort only

## Out of Scope

- Changing `/tasks` page filters/sort.
- Deep-linking / browser back for modal.

## Open Questions

None.
