# QA — dashboard-task-open-sort

> **Slug:** `dashboard-task-open-sort`
> **Date:** 2026-08-13

## Spec

`docs/specs/dashboard-task-open-sort.md`

## Commands

| Check | Result |
|---|---|
| `pnpm test` (API + web Vitest) | PASS — API 651, web includes `sort-tasks` 7/7 |
| `pnpm --filter @ak-system/web run test:e2e -- e2e/dashboard-task-open-sort.spec.ts` | PASS — 1/1 |
| `pnpm --filter @ak-system/web build` | PASS |

## Coverage

- Vitest: `apps/web/src/lib/sort-tasks.test.ts` — all five dashboard sort modes + validator
- Playwright: title opens `TaskModal`; checkbox does not; sort select visible on dashboard

## Notes

- `pnpm -r run lint` prompts interactively for ESLint setup (missing config in `apps/web`) — pre-existing; not introduced by this change. Build’s lint step completed without error.
