# Notion Tasks + People Sync (60-day)

> **Slug:** `notion-tasks-people-sync`
> **Status:** Draft
> **Last Updated:** 2026-07-16

## Goal

Persist Notion tasks and the Notion people directory into the app's real database (Postgres in production, SQLite in dev — same `getDb()` layer), instead of only reading Notion live at agent runtime. The sync pulls tasks assigned to the user (`NOTION_USER_NAME`) **and** tasks assigned to other people who exist in the Notion people directory, upserts those people into the `people` table, and links every synced task to its person(s) via `tasks.assigneeId` + the `task_people` join table. Scope is bounded to roughly the last 60 days so the sync stays cheap and relevant. This runs on a schedule (like calendar sync) so production data stays current.

## User Stories

- As the user, I want Notion tasks assigned to me to appear in `/tasks` and feed reminders/agents, so I don't have to open Notion.
- As the user, I want tasks assigned to other people in my Notion people directory to be captured and linked to those people, so the `/people` "related" view shows who owns what.
- As the user, I want the sync to only look at the last ~60 days, so old/irrelevant tasks are not imported.

## Acceptance Criteria

- [ ] `people` and `tasks` tables gain Notion linkage columns in **both** `schema.ts` and `schema.pg.ts`, plus guarded SQLite `ALTER TABLE` bootstrap in `packages/database/src/index.ts`.
- [ ] A self-contained sync service `packages/api/src/services/notion-tasks-sync.ts` reads Notion (tasks + people databases) using a 60-day window and upserts into the app DB.
- [ ] Notion directory people are upserted into `people` with `source='notion'` and `notionPageId` set; dedupe order is `notionPageId` → `email` (case-insensitive) → exact name.
- [ ] A person row for the user (`NOTION_USER_NAME`) is ensured to exist.
- [ ] A Notion task is imported when the user is an assignee **OR** at least one assignee/related person matches a directory person. Done tasks are skipped.
- [ ] Imported tasks are upserted by `notionPageId`; `assigneeId` = the user if assigned, else the first matched directory person; all matched people are linked via `task_people`.
- [ ] Re-running the sync does not create duplicates (idempotent by `notionPageId`).
- [ ] Notion-sourced tasks whose page is no longer returned in-window are pruned; `source='manual'` tasks are never touched.
- [ ] `tasks.syncFromNotion` mutation and `tasks.notionConfigured` query exist and are auth-protected.
- [ ] A cron route `apps/web/src/app/api/cron/notion-sync/route.ts` triggers the sync (optional `CRON_SECRET` bearer check), with an entry added to `deploy/crontab.example`.
- [ ] `/tasks` exposes a manual "סנכרן מ-Notion" trigger that shows a result summary and disables when Notion is not configured.
- [ ] Vitest coverage for the sync service (people dedupe, 60-day filter, assignee linking, idempotency, prune).

## Data Model

Add to **both** `packages/database/src/schema.ts` (SQLite) and `packages/database/src/schema.pg.ts` (Postgres):

- `people`
  - `notionPageId: text('notion_page_id')` — nullable; indexed (`idx_people_notion_page_id`).
- `tasks`
  - `notionPageId: text('notion_page_id')` — nullable; indexed (`idx_tasks_notion_page_id`).
  - `source: text('source').notNull().default('manual')` — `'manual' | 'notion'`.
  - `notionAccount: text('notion_account')` — nullable provenance (account label).
  - `notionDb: text('notion_db')` — nullable provenance (database name).

Add a `TASK_SOURCES = ['manual', 'notion'] as const` export (and `TaskSource` type) alongside the existing `PEOPLE_SOURCES` in both schema files.

SQLite runtime migration (`packages/database/src/index.ts`) — new guarded arrays, applied in `getDb()` like `PEOPLE_COLUMNS`:
- `ALTER TABLE people ADD COLUMN notion_page_id TEXT`
- `CREATE INDEX IF NOT EXISTS idx_people_notion_page_id ON people(notion_page_id)`
- `ALTER TABLE tasks ADD COLUMN notion_page_id TEXT`
- `ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`
- `ALTER TABLE tasks ADD COLUMN notion_account TEXT`
- `ALTER TABLE tasks ADD COLUMN notion_db TEXT`
- `CREATE INDEX IF NOT EXISTS idx_tasks_notion_page_id ON tasks(notion_page_id)`

Postgres picks up the new columns via `db:push` in `scripts/production-start.sh`.

## tRPC API

Extend `packages/api/src/routers/tasks.ts` (auth required — `protectedProcedure`):

- `notionConfigured: query() -> { configured: boolean }`
  - Returns whether any Notion account with a `tasks` database is configured.
- `syncFromNotion: mutation(input: { windowDays?: number (default 60), dryRun?: boolean (default false) }) -> NotionTasksSyncResult`
  - Calls `syncNotionTasks(opts, ctx.db)`; returns `{ peopleCreated, peopleUpdated, tasksCreated, tasksUpdated, tasksSkipped, tasksPruned, errors: string[] }`.

The heavy lifting lives in the self-contained service (mirrors `notion-ibkr-import.ts`), because `packages/api` cannot import `apps/web/src/lib/notion.ts`. The service:
- Resolves Notion config from `NOTION_ACCOUNTS` / `NOTION_API_KEY` (same parsing approach as `notion-ibkr-import.ts`).
- Provides `queryDatabase(token, dbId, filter?)` with a Notion API filter. The 60-day window uses **timestamp filters** (`created_time` OR `last_edited_time` `on_or_after` cutoff) rather than a named date property, since task-DB date property names vary across databases. The task's own due date is still parsed and stored.
- Fetches `people`-type databases for the directory and `tasks`-type databases for tasks.

## UI Surface

`apps/web/src/app/tasks/page.tsx`:
- Add a secondary "סנכרן מ-Notion" button next to "+ משימה חדשה" in the header.
- Uses `trpc.tasks.notionConfigured` to enable/disable; `trpc.tasks.syncFromNotion` mutation on click.
- While running, show a loading label; on success show a brief summary (e.g. "יובאו N משימות") and invalidate `trpc.tasks.list` + `trpc.people.list`.
- Hebrew, RTL, uses existing `.btn` classes and dark theme. No new components required.

## Out of Scope

- No write-back to Notion (Notion stays system of record per `docs/notion-vs-ak-system-review.md`).
- No change to the existing agent runtime `getNotionTasks()` / `getNotionContext()` behavior in `apps/web/src/lib/notion.ts`.
- No mobile UI trigger (cron + web button only).
- No reconciliation of tasks created manually vs. later found in Notion (matching is by `notionPageId` only).

## Open Questions

- Exact primary-assignee rule when the user is not among assignees and multiple directory people are: defaulting to the first matched person; revisit if ordering matters.
- Whether tasks reference people via the Notion `people` (user) property or a `relation` to the People DB — the service supports both (name match for `people` props, page-id match for `relation` props).
