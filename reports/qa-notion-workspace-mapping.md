# QA Report — Notion Workspace Mapping & Rich Task Status

Spec: `docs/specs/notion-workspace-mapping.md`
Stack: `next-trpc-monorepo`
Date: 2026-07-30

## Commands run

| Check | Command | Result |
|---|---|---|
| Unit/integration (API) | `pnpm --filter @ak-system/api test` | ✅ 200 passed (23 files) |
| Web typecheck + build | `pnpm --filter @ak-system/web build` | ✅ compiled, all routes generated |
| Package typecheck (mobile/bridge) | `pnpm -r run lint` | ✅ tsc passes; ⚠️ `apps/web` `next lint` blocked by missing ESLint config (pre-existing, interactive prompt) |

## Test coverage added

New/extended Vitest cases (all green):

- `notion-tasks-sync.workspaces.test.ts`
  - `resolveWorkspaceId` — explicit database-id link wins over label match; falls back to label when no id link.
  - `guessCanonicalStatus` — English + Hebrew keyword buckets, incl. `"Not started"` (guards against `started ⊂ not started`).
  - `resolveCanonicalStatus` — override wins over the keyword guess (case-insensitive); guess used otherwise.
  - Integration: done/cancelled Notion tasks are **kept** (not skipped) and record `status` + `notionStatusRaw`; explicit db-id link assigns workspace over the label; user override applied during sync.
- `workspaces.test.ts` — link/unlink flows, conflict on double-linking, idempotent re-link, cascade cleanup of links on workspace delete, `notionDatabases` surfaced on `list`/`getById`.
- `notion-status-overrides.test.ts` — `upsert` single-row-per-label create→update; `delete`; `unmapped` distinct labels with counts + guess, excluding overridden; tasks router `status ⇄ done` coupling (create/update/toggleDone).

## Behavior-change tests updated

`notion-tasks-sync.test.ts` previously asserted the old "skip done, prune when done" behavior. Updated to the spec's new contract:

- Done task assigned to the user is now **created** (tasksCreated 3→4, tasksSkipped 2→1) with `status='done'`, `done=true`.
- A task that becomes done in Notion is **kept** (`tasksPruned` 0) rather than pruned.
- `dryRun` count reflects the kept done task (3→4).

## Manual/deferred

- Playwright e2e: no new spec authored for this feature; existing suites unaffected (UI additions are additive — status chips, StatusPill, new settings page). Recommend a smoke pass in a running env for the `/settings/notion-statuses` mapping flow and the WorkspaceModal link checklist.
- DAZ onboarding (separate Notion integration + `NOTION_ACCOUNTS` env) is a manual production step; code surfaces linkable databases automatically once configured.

## Verdict

PASS — unit/integration suite green (200/200), web build green. No source regressions introduced. `next lint` failure is environmental (ESLint not initialized) and pre-existing.
