# Notion task pull: People relation (not only Assignee)

> **Slug:** `notion-task-people-relation-pull`
> **Status:** Approved
> **Last Updated:** 2026-08-13
> **Stack:** `next-trpc-monorepo`
> **Builds on:** [`notion-tasks-people-sync`](notion-tasks-people-sync.md), [`notion-task-people-relation-push`](notion-task-people-relation-push.md), [`contact-relationship-graph`](contact-relationship-graph.md)

## Goal

Pull-sync Notion tasks that are linked to known people via the task database's **People directory relation**, even when the current user is not the Assignee. Today those tasks are skipped because relation page ids from DT/Con directories do not match `people.notionPageId` (which usually comes from DAZ People only). After this change, opening a person (e.g. Shani Asaraf) shows all related Notion tasks in the last 60 days, and those tasks can carry a resolved `projectId` for `/tasks` project filters.

## User Stories

- As the owner, I want Notion tasks that list Shani (or any known person) in the People relation to appear in her person drawer, even when I am not the Assignee, so I see her full related work.
- As the owner, I want those tasks to remain linked in `task_people` so `people.getRelated` and the existing drawer keep working without UI changes.
- As the owner, I want a task's Projects relation to set `tasks.projectId` when the project already exists locally with `notionPageId`, so project filters and project pages show the right tasks.
- As the owner, I do not want unconfigured People directories to mass-create new CRM contacts; only name-match to existing people and store extra Notion page ids on `person_external_ids`.

## Acceptance Criteria

- [ ] Given a Notion task whose Assignee is someone else and whose People relation points at a directory page whose title matches an existing person (different page id than `people.notionPageId`), when `syncNotionTasks` runs, then the task is created/updated and linked in `task_people` to that person.
- [ ] Given a Notion task with no Assignee match and no People-relation name match to a known person, when sync runs, then the task is skipped (same as today for strangers).
- [ ] Given a Notion task assigned to me that also has a People relation matching Shani by directory title, when sync runs, then Shani is in `task_people` for that task.
- [ ] Given a task with a Projects relation whose page id matches `projects.notionPageId`, when sync upserts the task, then `tasks.projectId` is set to that project.
- [ ] Given pages in an unconfigured People directory that do not match any existing person name, when sync indexes that directory, then no new `people` rows are created.
- [ ] Matching directory page ids are upserted into `person_external_ids` (`provider='notion'`) so later syncs resolve by id without re-querying titles for already-seen pages.
- [ ] People-relation discovery uses the same heuristics as write-back: configured `people` DB target, or property name matching `/people|person|אנשים|אנשי\s*קשר/i`; self-relations on the task DB are never treated as people directories.
- [ ] Window, prune, and cron wiring stay as today (60-day task window; prune only in-window fetched-but-not-kept Notion tasks).
- [ ] Vitest covers the cases above; `pnpm test` passes for the api package.

## Data Model

None. Reuses `person_external_ids`, `task_people`, `tasks.projectId`, `projects.notionPageId`.

## tRPC API

None. Existing `tasks.syncFromNotion` / cron `notion-sync` call the updated service.

## UI Surface

None new. Existing surfaces that benefit:

- [`PersonDetailDrawer`](../../apps/web/src/components/people/PersonDetailDrawer.tsx) via `people.getRelated` (assignee + `task_people`)
- [`/tasks`](../../apps/web/src/app/tasks/page.tsx) (more rows; project filter works when `projectId` is set)
- Project detail task list when `projectId` is set

## Implementation Notes

- Extract shared helpers (`findPeopleRelation`, directory fetch/index, `sameId`, people-relation name regex) into e.g. `packages/api/src/services/notion-people-directory.ts` so pull and push do not duplicate heuristics (write-back already imports from `notion-tasks-sync`; prefer a small leaf module both can use).
- During task sync, for each task DB: discover people-relation target → query directory → map `pageId → title` → name-match existing people → `upsertPersonExternalId` + refresh `maps.byNotionId`.
- Resolve people on a task from: Assignee names ∪ people-relation page ids (via maps, including newly indexed ids).
- Resolve `projectId` from relation properties whose names match `/project|פרויקט/i` against `projects.notionPageId` (first hit wins). Do not invent projects.

## Out of Scope

- Adding DT/Con People directories to `NOTION_ACCOUNTS` as `type: people` (would mass-import contacts).
- Importing all Notion tasks with no known person link.
- Changing the 60-day window or adding a “only mine” filter on `/tasks`.
- Write-back / create-task changes.
- Mobile UI.

## Open Questions

None — product choices locked in the approved plan (name-match only; no mass person create; show related tasks on person + allow project filter).
