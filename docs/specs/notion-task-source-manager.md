# Notion Task Source Manager (paste-a-link, per workspace)

**Stack:** `next-trpc-monorepo`
**Slug:** `notion-task-source-manager`
**Status:** Approved
**Created:** 2026-10-07
**Depends on:** `notion-workspace-mapping` (workspace ↔ database link + task sync), `notion-people-source-manager` (paste-a-link pattern to copy)

## Goal

Task sync only scans Notion databases listed in `NOTION_ACCOUNTS` (type `tasks`), with a legacy fallback of three hardcoded database ids when that list is empty and `NOTION_API_KEY` is set. People sources can already be added from Settings by pasting a Notion link. This spec adds the same paste-a-link registration for task databases, scoped to a workspace (מקור), so a new database is pulled and written back by the existing task sync without editing env or redeploying.

## User Stories

- As the owner, I want to paste a Notion database link while editing a מקור and register it as that מקור's task database, so its tasks sync like the databases already configured in env.
- As the owner, I want databases already listed from `NOTION_ACCOUNTS` to keep appearing as checkboxes, so existing Dragontail / Consulting / Personal mappings do not change.
- As the owner, I want to remove a database I added by paste, so a mistaken registration stops being scanned.
- As the owner, I want a task created or updated in a מקור that only has a pasted database to push back to that Notion database, the same way env-linked databases do.
- As the owner, I want a pasted database whose Notion account was later removed from env to show up as a sync error, so the failure is visible on the tasks page.

## Acceptance Criteria

### Picker still shows env databases

- Given I edit a מקור, when the Notion section loads, then every `tasks` database from `resolveDatabases('tasks')` still appears as a checkbox with the current link / "מקושר ל-{name}" behavior (`workspaces.listNotionDatabases`, `linkNotionDatabase`, `unlinkNotionDatabase` unchanged for those rows).
- Given a מקור is not saved yet (`editingId` null), when the modal is open, then the section still says to save the מקור before linking, and the paste control is hidden.

### Adding a database by link

- Given a saved מקור and at least one Notion account, when I click "הוסף בסיס נתונים", then I see an account select (labels from `NOTION_ACCOUNTS`, no tokens) and one text field for a Notion link or bare id.
- Given I paste a link and pick an account, when I submit "בדוק", then the server extracts the database id with the existing `extractNotionDatabaseId` and calls `GET /v1/databases/{id}` with that account's token. On success the resolved title is shown and editable.
- Given the text has no 32-hex id, when I submit, then I see "לא זיהיתי מזהה בסיס נתונים בקישור הזה" and no Notion call is made.
- Given Notion returns 403 or 404, when the lookup runs, then I see "האינטגרציה של {account} לא משותפת לבסיס הנתונים הזה ב-Notion — שתף אותו קודם משם ונסה שוב".
- Given the id is already a `tasks` database in env, or already has a row in `workspace_notion_databases`, when I confirm add, then the mutation rejects with "בסיס הנתונים כבר רשום".
- Given the lookup succeeds and the id is new, when I confirm, then a `workspace_notion_databases` row is inserted for this מקור with `accountLabel`, `notionDatabaseId`, and `notionDatabaseName`, and the row appears in the list immediately. No process restart.

### Removing a pasted database

- Given a row whose id is not in the env task list (`source: 'custom'`), when I remove it and confirm, then `unlinkNotionDatabase` deletes the row. The database disappears from the picker and is not scanned on the next sync. Already-imported tasks stay.
- Given an env database, when I uncheck it, then only the link row is removed. The database stays in the picker. Env rows have no trash action.

### Sync and writeback

- Given one or more custom rows exist, when `syncNotionTasks` runs, then it scans env task databases and custom rows together. A custom row's token is `findNotionAccountToken(accountLabel)`. The token is never stored.
- Given a custom row's `accountLabel` matches no configured account, when sync runs, then that database is skipped and `errors` gains `task-source/{name}: לא נמצא חשבון Notion בשם "{accountLabel}"`.
- Given a מקור whose first link (by `createdAt`) is a custom row with a resolvable account, when a task is created in that מקור, then `resolveWorkspaceNotionTarget` returns that database and the existing create-push runs.
- Given a task whose `notionAccount` + `notionDb` match a custom row, when property / people / relation writeback runs, then `resolveTaskDatabaseTarget` resolves that database's token and id.
- Given the only task databases are custom rows (env task list empty, legacy fallback not used), when the tasks page loads, then `tasks.notionConfigured` is true and sync is allowed.

## Data Model

Additive column on the existing link table. Both `packages/database/src/schema.ts` (SQLite) and `packages/database/src/schema.pg.ts` (Postgres).

`workspace_notion_databases.account_label` — `text`, nullable.

- Null on rows created by the existing checkbox linker (env databases). Token still comes from `resolveDatabases('tasks')`.
- Set on rows created by paste-a-link. Required by the new mutation.

No new table. A task database is always מקור-scoped, and `notion_database_id` is already unique.

SQLite bootstrap in `packages/database/src/index.ts`: `ALTER TABLE workspace_notion_databases ADD COLUMN account_label TEXT` inside the existing idempotent column loop (same pattern as other `ALTER TABLE` blocks). Postgres: column is in `schema.pg.ts`; apply with the usual manual `drizzle-kit` / SQL push on deploy. No backfill. Existing link rows stay null and keep working.

## tRPC API

Extend `packages/api/src/routers/workspaces.ts`. All `protectedProcedure`.

`listNotionDatabases` — query, no input. Return shape gains `source: 'env' | 'custom'` and keeps `accountLabel`. Env entries come from `listConfiguredTaskDatabases()` joined to link rows (today's shape, `source: 'env'`, `accountLabel` from env). Custom entries are link rows whose `notionDatabaseId` is not in that env set (`source: 'custom'`, `accountLabel` from the column, `name` from `notionDatabaseName`). A custom row linked to another מקור is included so the UI can show "מקושר ל-…".

`resolveNotionTaskDatabaseLink` — mutation, input `{ accountLabel: string, link: string }`. Same id extraction and Notion `GET /v1/databases/{id}` as `people.resolveNotionDatabaseLink`. Returns `{ notionDatabaseId, name, alreadyAdded }`. `alreadyAdded` is true when the id is in `resolveDatabases('tasks')` or in `workspace_notion_databases`. No people field-mapping payload.

`addNotionTaskDatabase` — mutation, input `{ workspaceId: string, accountLabel: string, notionDatabaseId: string, notionDatabaseName: string }`. Rejects unknown account (`BAD_REQUEST`), unknown workspace (`NOT_FOUND`), and duplicate id (`CONFLICT`, message "בסיס הנתונים כבר רשום"). Inserts a link row with `accountLabel` set.

`unlinkNotionDatabase` — unchanged. Deleting the row is the remove path for custom sources.

`tasks.notionConfigured` in `packages/api/src/routers/tasks.ts` — returns `{ configured: true }` when `isNotionTasksConfigured()` is true or any `workspace_notion_databases` row has a non-null `accountLabel`.

### Sync engine (`packages/api/src/services/notion-tasks-sync.ts`)

Add `resolveTaskDatabases(db)` mirroring `resolvePeopleDatabases`:

1. Start from `resolveDatabases('tasks')` (env + legacy hardcoded fallback, unchanged).
2. Read `workspace_notion_databases`. Skip ids already present.
3. For a remaining row with `accountLabel` and a matching token, push a `NotionDb`. For a remaining row with no token, push the Hebrew error above and skip. Rows with null `accountLabel` that are not in the env list are skipped with the same error (link exists but the account is unknown).

`syncNotionTasks` uses `resolveTaskDatabases` instead of `resolveDatabases('tasks')` for the scan list. The "no task database configured" throw stays, but it fires only when the merged list is empty.

`resolveWorkspaceNotionTarget`: if the first link's id is in the env list, keep today's lookup. Otherwise resolve the token from the row's `accountLabel`.

`resolveTaskDatabaseTarget`: also consider custom link rows (match `accountLabel` + `notionDatabaseName`, same precedence as today). Callers in `notion-task-writeback.ts` await it. Signature becomes `async` and takes `db` (default `getDb()`).

`isNotionTasksConfigured()` stays env-only so existing unit tests keep their meaning. The tasks-page flag is the procedure described above.

## UI Surface

RTL, dark theme, existing `.btn` / `.input` / `.label` / `.modal`.

`apps/web/src/components/Modals/WorkspaceModal.tsx` — `NotionDatabaseLinks`:

- Env rows stay checkboxes.
- Custom rows render in the same list, checked when linked to this מקור, with a trash button (confirm: `להסיר את "{name}" ממקורות המשימות?`). Trash calls `unlinkNotionDatabase`.
- Under the list, when `workspaceId` is set: button "הוסף בסיס נתונים".

`apps/web/src/components/Modals/AddTaskSourceModal.tsx` — copy of the people paste modal without the phone/role/company/linkedin mapping step. Account select from `people.notionAccounts` (same label list; do not add a second accounts query). Link field, "בדוק" → `workspaces.resolveNotionTaskDatabaseLink`, editable name, "הוסף" → `workspaces.addNotionTaskDatabase` with the open מקור's id. Hebrew errors surfaced inline. Close and invalidate `workspaces.listNotionDatabases` and `workspaces.list` on success.

`/settings/workspaces` list caption already shows "🔗 N מקושרים" from `notionDatabases` on each מקור. `workspaces.list` / `getById` already return those link rows, so a pasted database counts without a page change.

## Out of Scope

- Paste-a-link for `meetings`, `projects`, `companies`, or `meeting_notes`.
- Per-property pinning for task fields (status, priority, due date, people relation). The existing name heuristics in the task pass apply to pasted databases. A database with unusual property names is a follow-up, same class of work as `notion-people-full-field-sync`.
- Removing `LEGACY_TASK_DATABASES`. It remains the fallback when env has no `tasks` entries and `NOTION_API_KEY` is set.
- Editing `NOTION_ACCOUNTS` or storing Notion tokens in the database.
- Deleting tasks that were imported from a database after that database is removed.
- Live Notion search (`POST /v1/search`).

## Open Questions

- None. Removing a pasted source does not delete imported tasks, matching the people-source decision.
