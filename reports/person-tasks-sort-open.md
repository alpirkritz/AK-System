# person-tasks-sort-open — Review

> **Slug:** `person-tasks-sort-open`
> **Date:** 2026-08-12

## Spec

`docs/specs/person-tasks-sort-open.md`

## UI/UX Review

- **Verdict:** APPROVED
- Open tasks first, then oldest due date; click title opens TaskModal; Escape with modal open does not close the person drawer.
- Checkbox remains independent of row open.

## Implementation

- `apps/web/src/lib/sort-tasks.ts` (+ Vitest)
- `PersonDetailDrawer` — sort + TaskModal
- `projects/[id]/page.tsx` — same sort

## Verdict

**APPROVED**
