# dashboard-task-open-sort — Review

> **Slug:** `dashboard-task-open-sort`
> **Date:** 2026-08-13

## Spec

`docs/specs/dashboard-task-open-sort.md`

## UI/UX Review

**Verdict:** APPROVED

### Checklist
- [x] Uses `.select` / `.card` / `.task-row` / `.checkbox-btn` utilities
- [x] Dark theme colors match palette
- [x] RTL layout preserved (`text-right` on title button, Hebrew labels)
- [x] Mobile: sort select wraps with heading via `flex-wrap`
- [x] Empty state unchanged («אין משימות פתוחות»)
- [x] Reuses existing `TaskModal`
- [x] Checkbox independent of title click; `aria-label="מיון משימות"` on select

### Findings
- Must-fix: none
- Nits: none

## Spec Conformance

- [x] Title click opens `TaskModal` with `editingTaskId`
- [x] Checkbox toggles done without opening modal
- [x] Close invalidates `tasks.list`
- [x] Due date shown on row when present
- [x] Sort select with five modes; default `due_asc`; persisted at `LS.DASHBOARD_TASKS_SORT`
- [x] Missing due dates last; tie-break due then id

## Implementation

- `apps/web/src/lib/sort-tasks.ts` — `sortDashboardTasks` + options
- `apps/web/src/lib/ls-keys.ts` — `DASHBOARD_TASKS_SORT`
- `apps/web/src/app/page.tsx` — modal + sort UI
- `apps/web/src/lib/sort-tasks.test.ts`
- `apps/web/e2e/dashboard-task-open-sort.spec.ts`

## Static checks

| Check | Result |
|---|---|
| Vitest (`pnpm test`) | PASS |
| Playwright (feature spec) | PASS |
| `pnpm --filter @ak-system/web build` | PASS |
| `pnpm -r run lint` | SKIPPED / env — `next lint` interactive prompt (no eslint config); pre-existing |

## Security

- No new API surface; localStorage preference only; tRPC client unchanged pattern

## Follow-up (2026-08-13)

Horizontal overflow: title was a `<button>` inside a CSS grid column; flex `min-width: auto` on buttons widened the open-tasks column past the viewport.

## UI/UX Review

**Verdict:** APPROVED  
**Detected stack:** next-trpc-monorepo

### Design System Checklist
- [x] Matches project tokens/classes (`.checkbox-btn`, `.section-link`, `.dashboard-open-task`)
- [x] RTL layout preserved
- [x] Mobile layout works (`grid-cols-1` / `md:grid-cols-2`)
- [x] No unapproved UI frameworks introduced
- [x] Reuses `TaskModal` for full details

### UX Quality Checklist
- [x] Clear visual hierarchy — checkbox + title (+ priority dot); zero competing chips
- [x] Cognitive load minimized — preview of 8; due/status/assignee deferred to modal
- [x] Empty state present
- [x] Microcopy: «עוד N משימות בדף המשימות»
- [x] Keyboard: real `<button>` title; sort labeled
- [x] **No horizontal scroll** — `html/body` + `main` overflow-x hidden; title uses flex `flex:1 1 0; width:0; ellipsis`

### Findings
- Must-fix: none
- Nits: none for this goal (zero horizontal scroll is the product constraint)

See also: `reports/qa-ui-dashboard-task-open-sort.md`

## Verdict

**APPROVED**
