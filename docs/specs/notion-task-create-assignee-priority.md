# Spec — push assignee, priority and the chosen status when creating a Notion task

**Slug:** `notion-task-create-assignee-priority`
**Stack:** `next-trpc-monorepo`
**Supersedes the "out of scope" call in:** [`notion-task-create-push.md`](notion-task-create-push.md)

## Problem

Creating a task with a linked workspace does create a Notion page, but the page comes out with **no assignee**, **no priority**, and always the "not started" status regardless of what the user picked. Two consequences, both observed in production on 09/08/2026 with the task "ניסיון" (page `3b7e7d50-cb8e-8185-aa1c-d3826d64e942` in `DT - Action items`):

1. **The task is invisible to the user.** Task database views are filtered by `Assignee`, so an unassigned page does not show up anywhere the user actually looks. From the user's side this reads as "the app still doesn't create tasks in Notion" even though the page exists.
2. **The task is deleted from the app on the next pull-sync.** `syncNotionTasks` keeps a page only when it resolves to a known person (`!userIsAssignee && matched.size === 0` → skipped), and the prune step then removes any in-window page that was fetched but not kept. A dry-run against production returned `tasksPruned: 1`, pointing at exactly this task. So the current behaviour is round-trip lossy: create a task, and it disappears from the app the next time Notion syncs.

The original spec deferred assignee/priority push as v1 out-of-scope, on the reasoning that priority had no reliable label heuristic. That call is what causes both failures above, so this spec reverses it.

## Schema survey (all four configured task databases)

Confirmed live against every linked database. The shape is uniform, so a single strategy covers all of them:

| Database | People property | Priority options | Status options |
|---|---|---|---|
| Personal To-do | `Assignee` | Critical, High, Medium, Low | Not started, In progress, Pending, Done, Canceled |
| DT - Action items | `Assignee` | High, Medium, Low | Pending, Not started, In progress, Cancelled, Done |
| Con Action items | `Assignee` | High, Medium, Low | Not started, Pending, In progress, Cancelled, Done |
| DAZ Tasks | `Assignee` | High, Medium, Low | Pending, Not Started, In Progress, Testing, Done, Archived |

Each database has exactly one `people`-type property, so "first `people` property" is an unambiguous target.

## Approach

### Assignee

Mirror the read path, which matches Notion users by name (`getPeopleNames` → `maps.byName`).

1. Extend the cached `DatabaseSchema` with `peoplePropertyName` — the first `people`-type property, or `null`.
2. New `resolveNotionUserId(token, { name, email })`: `GET /v1/users` (paginated), cached per token with the same 5-minute TTL as the schema cache. Match `type === 'person'` by email first (case-insensitive), then by name (case-insensitive). Returns `null` when nothing matches.
3. `createNotionTask` sets `{ people: [{ id }] }` on the people property when both the property and a resolved user exist.

Resolution failure is never fatal — the page is still created, just unassigned, exactly as today.

### Priority

Add a `priority` slot to the cached schema: the first `select`/`status` property whose name contains `priority` or `עדיפות` (the same predicate `findStatusPropertyName` already uses to *exclude* it from status detection, so the two never target the same property).

`pickPriorityLabel(target, options)` resolves a label in two passes:

1. **Exact match** on the canonical English word (`high`/`medium`/`low`), case-insensitive.
2. **Keyword bucket** fallback, mirroring the read path's `getPriority`: `high` ← high/urgent/critical, `low` ← low, everything else `medium`. First option in Notion's own order wins.

The exact pass exists because of Personal To-do: its options lead with `Critical`, which a pure bucket match would pick for a plain "high" task. Exact-first yields `High` there and still degrades correctly for databases using non-English labels.

### Status

`createNotionTask` currently hardcodes `pickNotionLabel('not_started', ...)`. Take the task's actual canonical status instead, reusing `pickNotionLabel` unchanged, and fall back to omitting the property when no option maps — same tolerance as today. This is what the original spec's own pseudo-code intended (`createNotionTask({ target, title, dueDate, status })`); the implementation just never wired the argument through.

### Router

`tasks.create` already resolves `assigneeId` (defaulting to the owner). Load that person's `name`/`email` and pass them, along with `priority` and `status`, into `createNotionTask`. When `assigneeId` is `null` (user picked "ללא אחראי"), pass no assignee and leave the Notion property empty.

## Changes

- `packages/api/src/services/notion-task-writeback.ts` — `DatabaseSchema` gains `peoplePropertyName` and `priority`; new `resolveNotionUserId` (+ its cache and a test-only reset); new exported `pickPriorityLabel`; `createNotionTask` gains `assignee`, `priority`, `status` inputs.
- `packages/api/src/routers/tasks.ts` — `create` looks up the assignee row and forwards the three new fields.
- No schema migration: nothing new is persisted locally.

## Out of Scope

- Writing the `📇 People directory` / `People` **relation** properties. The `people` Assignee property alone satisfies both the user's filtered views and `getPeopleNames` in the pull-sync, and picking the right relation would mean matching each relation's target database against the configured people database.
- Assigning to people who are not Notion workspace users — unresolvable by definition; the page is created unassigned.
- Back-filling assignee/priority onto pages created before this change.
- Pushing assignee/priority on **update**; this spec only covers creation, matching the existing split.

## Acceptance Criteria

- [ ] A task created with an assignee who is a Notion user sets that user on the database's people property.
- [ ] A task created with no assignee still creates the page, with the people property left empty.
- [ ] An assignee that cannot be resolved to a Notion user does not fail the create.
- [ ] Priority `high` picks `High` (not `Critical`) in a database whose options are Critical/High/Medium/Low.
- [ ] Priority falls back to the keyword bucket when no exact label matches.
- [ ] The status chosen at creation is what lands in Notion, not a hardcoded "not started".
- [ ] A page created this way survives a subsequent `syncNotionTasks` run — it is kept, not pruned.
- [ ] `pnpm test` and `pnpm --filter @ak-system/web build` pass.
