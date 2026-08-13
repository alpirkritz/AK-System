# Code Review: Notion task pull — People relation

> **Slug:** `notion-task-people-relation-pull`
> **Spec:** [`docs/specs/notion-task-people-relation-pull.md`](../docs/specs/notion-task-people-relation-pull.md)
> **QA:** [`reports/qa-notion-task-people-relation-pull.md`](qa-notion-task-people-relation-pull.md)
> **Date:** 2026-08-13
> **Verdict:** APPROVED

## Scope reviewed

| File | Change |
|---|---|
| `docs/specs/notion-task-people-relation-pull.md` | PM spec |
| `packages/api/src/services/notion-people-directory.ts` | **New** — shared `findPeopleRelation`, directory index (name↔pageId), schema fetch, cache clear |
| `packages/api/src/services/notion-task-writeback.ts` | Uses shared directory helpers; `directory.byName` for push |
| `packages/api/src/services/notion-tasks-sync.ts` | Index unconfigured People dirs by title→existing person; resolve People relation + `projectId` on upsert |
| `packages/api/src/services/notion-tasks-sync.test.ts` | +5 cases for pull-via-directory, skip, projectId, no mass-create |

No schema / tRPC / UI changes (by design).

## Spec conformance

- [x] Tasks kept when People-directory relation matches an existing person by title (even if page id ≠ `people.notionPageId`)
- [x] Skipped when no assignee and no name match
- [x] Related person linked on owner’s tasks via `task_people`
- [x] `projectId` set from Projects relation when local project has matching `notionPageId`
- [x] Unmatched directory pages do not create `people` rows
- [x] Matched page ids upserted into `person_external_ids`
- [x] Same people-relation heuristics as write-back; self-relations excluded
- [x] 60-day window / prune / cron unchanged

## Correctness notes

- **Root cause fix is right.** Pull previously resolved all relation page ids only via `maps.byNotionId` (configured people DBs + `person_external_ids`). DT/Con directories were never indexed, so non-assignee tasks were skipped. Indexing discovered directories by title against existing CRM names mirrors write-back and stores external ids for the next run.
- **No CRM pollution.** Explicitly skips person creation for unconfigured directories — consistent with the push-spec decision not to add those DBs as `type: people`.
- **People vs Projects relations separated.** When schema discovery succeeds, only the people-relation property feeds person matching; Projects relations set `projectId` separately. Fallback to all-relation ids remains when schema fetch fails (keeps older fixtures working).
- **Extraction avoids circular imports.** Leaf module `notion-people-directory.ts` does not import sync; sync and writeback both call it with `listConfiguredPeopleDatabaseIds()` as an argument.

## UI Review

**Verdict:** APPROVED (N/A surface)

No UI code changed. Person drawer, `/tasks` project filter, and project pages already consume the persisted links.

## Findings

None blocking.

**Nit (pre-existing):** Root `pnpm test` pretest / `apps/web` `next lint` remain flaky or interactive outside this change (documented in QA).

## Gates

| Gate | Result |
|---|---|
| API Vitest | 651 passed |
| Web Vitest | 154 passed |
| `pnpm --filter @ak-system/web build` | success |
| `pnpm -r run lint` | web blocked by pre-existing missing ESLint interactive setup; mobile/whatsapp-bridge `tsc --noEmit` OK |

## Deploy note

After deploy, run **סנכרן מ-Notion** (or wait for cron) so existing in-window tasks pick up People-directory links and `projectId`. No env changes required.
