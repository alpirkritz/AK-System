# QA — Task Workspaces (מקורות) + Global Quick-Add

**Detected stack:** `next-trpc-monorepo`
**Spec:** [docs/specs/task-workspaces.md](../docs/specs/task-workspaces.md)
**Date:** 2026-07-27

## Summary

| Gate | Command | Result |
|---|---|---|
| Unit / integration | `pnpm --filter @ak-system/api run test` | **180 passed / 180** (3 consecutive runs) |
| New feature e2e | `npx playwright test e2e/task-workspaces.spec.ts` | **4 passed / 4** |
| Full e2e | `pnpm e2e` | 22 passed, 11 failed — **all pre-existing**, see below |
| Type check (web) | `pnpm --filter @ak-system/web exec tsc --noEmit` | Pre-existing errors only (drizzle dual-dialect union, missing `@types/pg`, `@types/pdf-parse`) |
| Build | `pnpm --filter @ak-system/web build` | **Passed** — `/settings/workspaces` emitted (3.3 kB) |
| Lint | `pnpm -r run lint` | `apps/web` blocked pre-existing: `next lint` has no ESLint config and prompts interactively. `apps/mobile` + `apps/whatsapp-bridge` (`tsc --noEmit`) pass. |

## New test coverage

**`packages/api/src/routers/workspaces.test.ts` (12 tests)**
- Seeded defaults present (Alpir Consulting, Dragontail, DAZ, פרטי).
- Create with color + Notion label; blank label normalizes to `null`.
- Update name / color / label; label clears on `null`.
- Delete removes the workspace and nulls `tasks.workspaceId` (task survives).
- Task `workspaceId` on create / update / clear; omitted field leaves assignment untouched.
- `tasks.list` unfiltered and filtered by `workspaceId`; `tasks.listByWorkspace`.

**`packages/api/src/services/notion-tasks-sync.workspaces.test.ts` (8 tests)**
- `buildWorkspaceLabelMap` lowercases and skips blank labels.
- `resolveWorkspaceId` matches database name, falls back to account label, prefers the database name, returns `null` on no match.
- Sync integration: a task in "DT - Action items" under the DAZ account lands in the Dragontail workspace; stays `null` when no label matches; the assignment survives a re-sync.

**`apps/web/e2e/task-workspaces.spec.ts` (4 tests)**
- Quick-add FAB from `/people`: title autofocused, source selected, toast shown, task appears on `/tasks` with the Dragontail pill.
- Escape closes quick-add without creating a task.
- Workspace chips filter the list and "הכל" restores it.
- Settings → מקורות lists the four seeded sources and persists a Notion label.

## Bugs found and fixed during QA

1. **Task id collision (`packages/api/src/routers/tasks.ts:62`).** Ids were `'t' + Date.now()`, so two tasks created in the same millisecond collided — reproducible as intermittent test failures, and far more likely now that quick-add exists. Now suffixed with a random segment, matching the pattern already used in `finance.ts`, `vat.ts`, `meetings.ts`. Same fix applied to `workspaces.create`.
2. **Workspace edit modal discarded typing (`apps/web/src/components/Modals/WorkspaceModal.tsx`).** The `getById` result hydrated the form on every change, so a value typed before the query resolved was silently overwritten and the save wrote the stale value. The modal now shows a loading state until the record arrives and hydrates once per open.
3. **Ambiguous "הכל" control (`apps/web/src/app/tasks/page.tsx`).** The workspace "all" chip was indistinguishable from the status "all" chip for assistive tech and for tests. The source chips are now a labelled `role="group"` (`סינון לפי מקור`).
4. **Flaky suite (`packages/api/vitest.config.ts`).** All suites share one SQLite file and wipe tables in `beforeEach`; parallel files clobbered each other. Set `fileParallelism: false`.

## Pre-existing failures (not caused by this change)

All 11 failures are stale assertions against UI that changed in earlier committed work. None touch tasks, workspaces, the FAB, or any file in this change set.

| Spec | Failure | Reason |
|---|---|---|
| `qa-structured.spec.ts` (4) | `heading /שלום/` not found | Dashboard greeting is time-based (`בוקר טוב` / `צהריים טובים` / `ערב טוב`) in `apps/web/src/app/page.tsx:16` |
| `full-flow.spec.ts` (2) | `heading /שלום/` not found | Same |
| `notifications.spec.ts` (3) | `heading /צ.?אט/` not found | Chat page heading changed |
| `agents-triggers.spec.ts` (1) | `heading 'סוכנים'` not found | Agents page heading changed |
| `trading-journal.spec.ts` (1) | strict mode violation on `P&L ממומש` | Two matching elements after a finance UI change |

## Notes for the operator

- The API test DB (`packages/api/test-data/ak_system.sqlite`) needed one manual rebuild: the first `drizzle-kit push` after adding the `workspaces` table prompted interactively ("create table" vs "rename from google_connections") and exited mid-migration, leaving `tasks.workspace_id` added by the runtime bootstrap but without the FK. Deleting the file and re-running `pnpm test` produced a clean, idempotent schema. The same one-off prompt should be expected on any existing database the first time `db:push` runs.
- Production/dev SQLite databases migrate through the runtime bootstrap in `packages/database/src/index.ts` (`ALTER TABLE tasks ADD COLUMN workspace_id`, `CREATE TABLE IF NOT EXISTS workspaces`, `INSERT OR IGNORE` seeds) — no manual step required.

**QA verdict: PASS** for this change set.
