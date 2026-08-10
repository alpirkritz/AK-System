# Spec — push a task's related people into the Notion People-directory relation

**Slug:** `notion-task-people-relation-push`
**Stack:** `next-trpc-monorepo`
**Builds on:** [`notion-task-create-assignee-priority.md`](notion-task-create-assignee-priority.md)

## Goal

"קשור לאנשים" on a task should land in the task database's People-directory **relation** in Notion, so a task opened in the app carries the same people links as one created in Notion by hand.

## Why the obvious approach does not work

The read path resolves relations through `people.notionPageId` (`maps.byNotionId`). Writing the same way fails on the live data:

- Only **31 of 144** local people rows have a `notionPageId`, and all 31 come from `DAZ People` — the only `people`-type database in `NOTION_ACCOUNTS`.
- The relation targets the task databases actually use are **not** configured anywhere: `DT - Action items` → `📇 People directory` (`120e7d50…`, 54 pages) and `Con Action items` → `People` (`20ee7d50…`, 100 pages). Both are reachable by the existing token, just unconfigured.
- More fundamentally, `people.notionPageId` is a **single** column, while the same human legitimately exists as a separate page in the DT, Con and DAZ directories. One column cannot express membership in several directories, so it is the wrong key for this job no matter what is configured.

Adding the two directories as `people`-type databases would also pull 154 new contacts into the app's people list as a side effect, which is not something this feature should decide.

So people are resolved **per target database, by name, at push time**.

## Approach

### Locating the relation property

`DatabaseSchema` gains `peopleRelation: { propertyName, targetDatabaseId } | null`. A relation property qualifies when:

1. Its target database is a configured `people`-type database (strongest signal), **or**
2. Its name matches `/people|person|אנשים|אנשי\s*קשר/i`.

Self-referencing relations (target = the task database itself, e.g. `Sub-task`, `Parent task`) are excluded outright. Verified against all four live databases: this selects `📇 People directory` and `People`, and selects nothing for `Personal To-do` (no relations) or `DAZ Tasks` (no relation to `DAZ People` exists), while never selecting `Projects`, `Meeting`, `Blocked by` or the task self-links.

### Resolving names to pages

`fetchPeopleDirectoryIndex(token, databaseId)` queries the target database and builds a `Map<lowercased title, pageId>`, cached per database id under the same 5-minute TTL as the schema cache — the directories are 54–100 pages, so re-querying per write would be wasteful.

**This is also the safety net.** Only ids found by an exact case-insensitive title match inside that specific database are ever written. If heuristic (2) ever picked the wrong relation, no person's name would match a page title there and the write would resolve to nothing rather than corrupting data.

### Writing

`pushTaskPeople({ notionPageId, notionAccount, notionDb, personNames })`, mirroring `pushTaskStatus`'s never-throw contract:

| Input | Behaviour |
|---|---|
| Empty `personNames` | PATCH the relation to `[]` — the user cleared the list, so Notion must follow |
| Some names resolve | PATCH with the resolved ids (partial is fine) |
| Names given, none resolve | **Skip the PATCH**, report `no-matching-people` — never wipe existing links because of a lookup miss |
| No relation property | Report `no-people-relation` |

New failure reasons extend `WriteBackFailure`.

### Where it hooks in

`taskPeople` rows are written **only** by `tasks.setTaskPeople`, and the clients call it *after* `tasks.create` returns (`TaskModal` chains `create` → `setTaskPeople`). So the related people are not known while the page is being created, and the push belongs in `setTaskPeople` rather than in `createNotionTask`. That placement also covers editing an existing task's people, which creation-time push would miss.

`setTaskPeople` returns `{ ok: true, notionSync }` so the UI can surface a failure the same way the other write-backs do.

## Changes

- `packages/api/src/services/notion-task-writeback.ts` — `peopleRelation` on the cached schema; `fetchPeopleDirectoryIndex` + cache; `pushTaskPeople`; two new `WriteBackFailure` values.
- `packages/api/src/routers/tasks.ts` — `setTaskPeople` loads the task and its people's names and pushes; return shape gains `notionSync`.
- No schema migration: nothing new is stored locally, which is the point of resolving by name.

## UI Surface

A person who is not in the Notion directory is skipped, and silence there is misleading — the user sees the person attached in the app and reasonably assumes Notion matches. The tasks page already owns a `syncMessage` banner (`apps/web/src/app/tasks/page.tsx`) fed by `toggleDone` and `onCreated`; related-people results reuse it rather than introducing a new pattern.

`TaskModal` gains an optional `onPeopleSync` callback, fired after `setTaskPeople` on both the create and the update path. A pure mapper, `notionPeopleSyncMessage`, turns a result into Hebrew copy or `null`:

| Result | Message |
|---|---|
| All matched | none — silence is the success signal |
| Some or all unmatched | names the skipped people |
| `no-people-relation` | **none** — `DAZ Tasks` has no people relation by design, so this would nag on every save |
| `account` / `api` | generic "saved locally, Notion link failed" |

Names are Latin inside Hebrew text, so each is wrapped in Unicode isolates (FSI/PDI) to keep bidi punctuation from breaking.

`no-matching-people` also starts carrying `unmatched`, so the copy can name who was skipped in that case too.

## Out of Scope

- **`Projects` and `Meeting` relations.** `projects` has no `notion_page_id` column at all and neither does `meetings`, so there is nothing to resolve them against. Supporting those means adding columns and a sync pass — a separate spec.
- Creating a directory page for a person who has none. Unmatched people are skipped, not invented.
- Pushing related people on `tasks.create` (the clients cannot supply them in that call).
- Reconciling a person who appears twice in one directory under the same name; the first match wins.

## Acceptance Criteria

- [ ] Setting related people on a Notion-backed task writes their directory pages to the relation property.
- [ ] Clearing the related people list clears the relation in Notion.
- [ ] A person absent from that directory is skipped while the others still push.
- [ ] When no name resolves, the existing relation is left untouched and `no-matching-people` is reported.
- [ ] A database with no people relation reports `no-people-relation` without failing the mutation.
- [ ] A manual (non-Notion) task never calls Notion.
- [ ] Relation candidates named `Projects`/`Meeting`/`Sub-task`/`Parent task` are never written to.
- [ ] Saving a task whose related person is missing from the directory names that person in the banner.
- [ ] A task database with no people relation produces no banner at all.
- [ ] A fully successful push produces no banner.
- [ ] `pnpm test` and `pnpm --filter @ak-system/web build` pass.
