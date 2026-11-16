# task-open-and-create-defaults — APPROVED WITH NITS

Spec: `docs/specs/task-open-and-create-defaults.md`

## Checks
- `vitest run src/lib/task-due.test.ts` — 4/4 pass (new `shiftDayKey` case covers month/year edges).
- `next lint` on touched files — clean (one pre-existing warning in `app/tasks/page.tsx:150`).
- `pnpm --filter @ak-system/web build` — compiles.
- Not run: full `pnpm e2e`, manual browser pass.

## Round 2 — person card folding (criteria 6–8)
- Done/cancelled task groups and the meetings block fold; folded rows are not rendered. Meetings open/closed is persisted via the layout `BlockState`.
- `next lint` clean on `PersonDetailDrawer.tsx`; `tsc` error count for the file unchanged (15 before/after, all pre-existing implicit-any); build compiles.
- Data is still fetched by `people.getRelated` up front, so folding saves rendering, not the query.

## Round 3 — shared fold state, lighter card
- Done/cancelled fold state moved from local state to the `person` layout (`tasks/done`, `tasks/cancelled`) via new `BlockState.isPartOpen/setPartOpen`; `useLayout` keys a part under its block. One setting for all people, optimistic write, no extra query.
- The drawer no longer fetches `meetings.list` and `workspaces.list` on open; they load only when the task form opens.
- Lint clean, build compiles, layout unit tests pass.

## Round 4 — fold whole tasks block and meeting summaries
- "משימות" header folds the block (default open); "סיכומי ישיבות" folds (default closed). Both via `BlockState.open/onToggle`, shared by all people.
- Lint clean, no new `tsc` errors in the file, build compiles.

## e2e triage (deploy:ec2 CI gate, 2026-11-03)
The full run failed on tests outside this change; none traced to it:
- `dashboard-task-open-sort` — failed in the full run, passes alone (twice). Order-dependent.
- `task-assignee` (3) — fail with the pre-commit `TaskModal.tsx` too. The owner is assigned; the picker shows "אני" while the test expects "Alpir Kritzler". Stale test.
- `task-related-people` — flaky: the people picker is empty when no contacts exist yet in `e2e.sqlite`; untouched code.
- `calendar-link-and-commitment-task-modal` (2), `full-flow` (2), `person-context-circles` merge — selectors that no longer match the UI (modal title is not a heading, no "תפקיד" field, "פגישות חוזרות" heading, sidebar h2s).

## Nits
- Project-wide `tsc` currently reports ~2.7k implicit-any errors from unresolved tRPC types; none on the changed lines. The build skips type validation, so this is not caught in CI.
- Every new task from `TaskModal` now defaults to today, including the dashboard "+". The header quick-add keeps no date (out of scope).
