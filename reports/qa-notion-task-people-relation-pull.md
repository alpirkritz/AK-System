# QA: Notion task pull — People relation

> **Slug:** `notion-task-people-relation-pull`
> **Date:** 2026-08-13
> **Stack:** `next-trpc-monorepo`

## Commands

| Command | Result |
|---|---|
| `pnpm --filter @ak-system/api exec vitest run` | **PASS** — 51 files, 651 tests |
| `pnpm --filter @ak-system/web exec vitest run` | **PASS** — 21 files, 154 tests |
| Root `pnpm test` pretest (`drizzle-kit push`) | **Blocked** by pre-existing SQLite index conflict (`idx_person_external_ids_person_id already exists`); resolved by recreating `packages/api/test-data/ak_system.sqlite` then running vitest directly |

## Coverage vs acceptance criteria

| Criterion | Covered by |
|---|---|
| Task kept when only People-directory relation matches existing person (different page id) | `imports a task linked only via unconfigured People directory title match` |
| Skip when no assignee / no name match | `skips tasks with no assignee match and no People-relation name match` |
| My task + People relation → person in `task_people` | `links related person on my task via unconfigured People directory` |
| `projectId` from Projects relation | `sets projectId from Projects relation when project exists locally` |
| No mass-create from unmatched directory pages | `does not create people from unmatched unconfigured directory pages` |
| Regression: existing assignee + configured-people relation sync | original `syncNotionTasks` suite + workspaces suite |

## Notes

- No new E2E — no UI surface change; person drawer / `/tasks` already consume `task_people` + `projectId`.
- Write-back suite still green after extracting shared directory helpers (52 tests).

## Verdict

**PASS** — ready for reviewer.
