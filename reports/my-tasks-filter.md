# My tasks filter

**Verdict:** APPROVED WITH NITS

## UI Review

**Verdict:** APPROVED

### Checklist
- [x] Uses `.filter-chip` on the web tasks page
- [x] Dark theme colors match the existing chip styles
- [x] RTL layout preserved
- [x] Mobile uses the existing `FilterChips` row
- [x] Pressed state is `aria-pressed` on web and selected state on mobile chips
- [x] Empty state explains that other people's tasks are under "כולם"
- [x] No new CSS frameworks
- [x] Reuses the tasks list and dashboard sections

### Findings
- Must-fix: none
- Nits: the dashboard sort control is labeled "מיון", which is the existing `ThenBySort` label.

## What shipped

`/tasks` and the mobile tasks screen open on tasks whose `assigneeId` is the owner. "כולם" shows every task. The web and mobile home counts and previews use the same rule.

## Tests

- `apps/web/src/lib/my-tasks.test.ts` passed
- `e2e/my-tasks-filter.spec.ts` passed
