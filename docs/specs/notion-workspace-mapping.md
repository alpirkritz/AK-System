# Notion Database Linking + Rich Task Status

> **Slug:** `notion-workspace-mapping`
> **Status:** Draft
> **Detected stack:** `next-trpc-monorepo`
> **Last Updated:** 2026-07-30

## Goal

Today a workspace maps to Notion tasks only through a free-text `notionAccountLabel` matched loosely against a Notion database's name/account label, and every synced task collapses to a boolean `done`. Let Alpir link each workspace to the exact Notion database(s) it should pull from (by database id, not text), and carry a richer, Notion-faithful status (`not_started` / `in_progress` / `blocked` / `done` / `cancelled`) on every task instead of a single checkbox.

## User Stories

- As Alpir, I want to pick the exact Notion database(s) that feed a workspace from a list, instead of typing a label I have to get exactly right, so mapping is reliable.
- As Alpir, I want to see which Notion databases are already linked to a workspace, and which are still unclaimed, so I don't double-map by mistake.
- As Alpir, I want a task's status to reflect what it actually says in Notion (in progress, waiting, done, cancelled — not just checked/unchecked) so the app matches reality.
- As Alpir, I want Notion status labels I've never seen mapped yet to get a sensible default automatically, and I want to override that mapping myself for labels the guess gets wrong.
- As Alpir, I want tasks that are already marked done or cancelled in Notion to actually show up locally with that status, instead of silently vanishing from sync.
- As Alpir, existing workspace mappings (Dragontail, Alpir Consulting, Personal) set via the current text label must keep working after this change, with no re-configuration required.

## Acceptance Criteria

- [ ] A workspace can be linked to one or more Notion database ids via a picker populated from the currently configured Notion databases (`NOTION_ACCOUNTS` or legacy `NOTION_API_KEY`); linking persists in a new join table.
- [ ] A Notion database id already linked to workspace A shows as disabled/claimed (with A's name) when viewed while editing workspace B, preventing a double-link.
- [ ] Notion sync resolves a task's `workspaceId` by exact database-id match first; when no id link exists for that database, it falls back to the existing case-insensitive label match against `notionAccountLabel` (current Dragontail/Alpir Consulting/Personal setups keep working unmodified).
- [ ] `tasks.status` exists with 5 values (`not_started`, `in_progress`, `blocked`, `done`, `cancelled`); `tasks.done` is kept in sync as a derived value (`true` when status is `done` or `cancelled`, else `false`) so every existing `done`-based read (filters, checkboxes, other pages) keeps working unmodified.
- [ ] Notion sync captures the raw status/select property text into `tasks.notionStatusRaw` and resolves a canonical `status` via: (1) an exact case-insensitive override set by Alpir, else (2) a keyword heuristic across the 5 buckets, else (3) `not_started` when no status property is present.
- [ ] Notion sync no longer skips pages whose Notion status reads as done/cancelled — they are synced with the matching canonical status instead of being silently excluded (existing 60-day window and people-matching/pruning logic unchanged).
- [ ] A settings screen lists every distinct `notionStatusRaw` value seen in synced tasks with its resolved canonical status (guessed or overridden), lets Alpir set/clear a manual override per raw label, and changes apply on the next sync.
- [ ] `TaskModal` exposes all 5 statuses as chips (matching the existing priority-chip pattern); the tasks list quick-toggle checkbox continues to flip between `not_started` and `done` for one-click use.
- [ ] `pnpm --filter @ak-system/web build` and `pnpm -r run lint` pass; Vitest covers database-id resolution priority, the status heuristic, and the override lookup.

## Data Model

Changes to **`packages/database/src/schema.ts`** (SQLite) AND **`packages/database/src/schema.pg.ts`** (Postgres) — additive only.

### New table `workspaceNotionDatabases`

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | e.g. `wnd_...` |
| `workspaceId` | text, not null, FK → `workspaces.id`, `onDelete: 'cascade'` | |
| `notionDatabaseId` | text, not null, unique | the raw Notion database UUID |
| `notionDatabaseName` | text, nullable | cached display name from config, refreshed on link |
| `createdAt` | text, not null | ISO |

Unique index on `notionDatabaseId` (one Notion database maps to exactly one workspace). Index on `workspaceId`.

### New table `notionStatusOverrides`

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | e.g. `nso_...` |
| `rawLabel` | text, not null, unique | literal Notion status/select text, trimmed |
| `canonicalStatus` | text, not null | one of the 5 canonical values |
| `createdAt` / `updatedAt` | text, not null | ISO |

Matching in code is case-insensitive (build a lowercase `Map<rawLabel, canonicalStatus>` on read); the unique index itself stays case-sensitive.

### `tasks` — add two columns (both schemas)

- `status`: `text('status').notNull().default('not_started')`.
- `notionStatusRaw`: `text('notion_status_raw')`, nullable.

### Migration / bootstrap (`packages/database/src/index.ts`)

- Add `WORKSPACE_NOTION_DATABASES_TABLE` and `NOTION_STATUS_OVERRIDES_TABLE` `CREATE TABLE IF NOT EXISTS` statements, run in the SQLite bootstrap loop, plus their unique indexes.
- Extend `TASKS_COLUMNS` with `ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'not_started'` and `ALTER TABLE tasks ADD COLUMN notion_status_raw TEXT`.
- One-off backfill immediately after adding `status`: `UPDATE tasks SET status = 'done' WHERE done = 1 AND status = 'not_started'` (idempotent — only touches rows still at the column default), so existing checked tasks don't regress to "not started" in the new status views.
- Export `workspaceNotionDatabases` and `notionStatusOverrides` (runtime schema objects + `WorkspaceNotionDatabase`/`NotionStatusOverride` types) from `packages/database/src/index.ts`, following the existing export pattern.

Postgres parity is maintained in `schema.pg.ts`; the two new tables and columns are created via `drizzle-kit push`. The backfill `UPDATE` above must be run manually once against the Postgres production DB (`drizzle-kit push` does not run data migrations) — call out as a deploy step for the reviewer/QA agent.

### `packages/types/src/index.ts`

- Add `STATUS_COLORS: Record<TaskStatus, string>` — `not_started` `#7a89ab`, `in_progress` `#38bdf8`, `blocked` `#f59e0b`, `done` `#2dd4bf`, `cancelled` `#9a7bc4`. (`cancelled` intentionally uses a muted purple, not grey, so its pill is never confused with the existing grey "לא משויך" / disabled-text tone.)
- Add `STATUS_LABELS: Record<TaskStatus, string>` — `not_started` "לא התחיל", `in_progress` "בתהליך", `blocked` "ממתין", `done` "הושלם", `cancelled` "בוטל".
- Add `export type TaskStatus = keyof typeof STATUS_COLORS`.

## tRPC API

All procedures are `protectedProcedure`, matching existing routers.

### Extend `packages/api/src/routers/workspaces.ts`

| Procedure | Kind | Input (Zod) | Returns |
|---|---|---|---|
| `listNotionDatabases` | query | none | `{ notionDatabaseId, name, accountLabel, linkedWorkspaceId, linkedWorkspaceName }[]` — every Notion `tasks`-type database currently resolvable from env, via new `listConfiguredTaskDatabases()` export from `notion-tasks-sync.ts`, joined against existing links |
| `linkNotionDatabase` | mutation | `{ workspaceId: string, notionDatabaseId: string, notionDatabaseName?: string }` | created link row; throws `TRPCError({ code: 'CONFLICT' })` if `notionDatabaseId` is already linked to a different `workspaceId` |
| `unlinkNotionDatabase` | mutation | `{ id: string }` | `{ ok: true }` |

- `list` and `getById` responses gain `notionDatabases: { id, notionDatabaseId, notionDatabaseName }[]` per workspace (left join on `workspaceNotionDatabases`).

### New router `packages/api/src/routers/notion-status-overrides.ts`, mounted as `appRouter.notionStatusOverrides`

| Procedure | Kind | Input (Zod) | Returns |
|---|---|---|---|
| `list` | query | none | `NotionStatusOverride[]`, ordered by `rawLabel` |
| `upsert` | mutation | `{ rawLabel: string(min 1), canonicalStatus: enum }` | created/updated row; trims `rawLabel`, upserts by unique `rawLabel` |
| `delete` | mutation | `{ id: string }` | `{ ok: true }` |
| `unmapped` | query | none | distinct `notionStatusRaw` values from `tasks` with no matching override row, each with `{ rawLabel, taskCount, guessedStatus }` (guess computed via the same heuristic used by sync) |

### Extend `packages/api/src/routers/tasks.ts`

- `createInput` + `updateInput`: add `status: z.enum(['not_started','in_progress','blocked','done','cancelled']).optional()`.
- `create`: when `status` provided, derive `done = status === 'done' || status === 'cancelled'`; when omitted, default `status: 'not_started', done: false` (unchanged behavior for callers that don't send it).
- `update`: when `status` present in the payload, also set `done` from the same derivation; when absent, leave both untouched.
- `toggleDone`: keep flipping `done`, and set `status` to `'done'` when turning on, `'not_started'` when turning off (existing one-click semantic — does not attempt to restore a prior `blocked`/`in_progress` state).

### Extend `packages/api/src/services/notion-tasks-sync.ts`

- Export `listConfiguredTaskDatabases(): { notionDatabaseId, name, accountLabel }[]` — thin wrapper over the existing `resolveDatabases('tasks')`.
- Add `getStatusRaw(props)`: finds a `select`/`status` property whose name (lowercased) includes `"status"` and does not include `"priority"`; returns its trimmed text or `''` (mirrors the existing `getPriority` name-matching pattern).
- Add `resolveCanonicalStatus(rawStatus, overrides)`: (1) exact case-insensitive `overrides` map hit wins; (2) else a keyword heuristic bucket — `cancelled`: cancelled/canceled/archived/won't do/dropped; `done`: done/complete/completed/closed/resolved/finished; `blocked`: blocked/waiting/on hold/hold/stuck; `in_progress`: in progress/doing/active/started; anything else, or empty `rawStatus`, → `not_started`.
- Replace `resolveWorkspaceId`'s label-only lookup: first check a `Map<notionDatabaseId, workspaceId>` built from `workspaceNotionDatabases`; only fall back to the current `notionAccountLabel` string match when no id-based link exists for that database.
- Remove the `isDone(props)` early-skip in the tasks loop (and the now-unused `DONE_STATUSES` constant) so done/cancelled Notion pages are synced like any other page.
- In both the insert and update branches, set `status: resolveCanonicalStatus(...)`, `notionStatusRaw: rawStatus || null`, and `done` derived from `status`, instead of the current hardcoded `done: false`.

## UI Surface

RTL Hebrew, dark theme. Reuse existing classes: `.label`, `.input`, `.select`, `.btn` / `.btn-primary` / `.btn-ghost`, `.modal`, `.overlay`, `.pill`, `.filter-chip`, `.checkbox-btn`, and the existing priority-chip inline-style pattern from `TaskModal`.

### 1. `WorkspaceModal` (`apps/web/src/components/Modals/WorkspaceModal.tsx`)

- New section "בסיסי נתונים מקושרים ב-Notion" inserted between the color swatches and the existing free-text field, backed by `trpc.workspaces.listNotionDatabases`. Renders one checkbox row per configured database: `name` + muted `accountLabel`; a database linked to a different workspace renders disabled with caption "מקושר ל-{workspace name}". Checking/unchecking calls `linkNotionDatabase` / `unlinkNotionDatabase` immediately, independent of the name/color save, with explicit per-row feedback:
  - **Pending:** the row's checkbox is disabled and shows a small inline spinner for the duration of its own mutation, so a second click can't race it.
  - **Error:** the checkbox visually reverts to its previous checked state and a single inline line appears under the checklist — "לא הצלחנו לעדכן את הקישור. נסה שוב." — clearing on the next successful action.
  - **Empty state** when no databases are configured: "לא נמצאו בסיסי נתונים ב-Notion. בדוק את הגדרות החיבור."
  - Unlinking is not treated as destructive (no confirmation dialog): it only removes the mapping row, tasks and their data are untouched — consistent with keeping low-stakes settings actions frictionless.
- Relabel the existing free-text input from "תווית Notion" to "תווית Notion (גיבוי)" and update its helper text to "משמש רק אם לא קושר בסיס נתונים ספציפי למעלה" — kept for backward compatibility, no longer the primary path.

### 2. `/settings/workspaces` (`apps/web/src/app/settings/workspaces/page.tsx`)

- Each workspace row gains a small caption sourced from the same `listNotionDatabases` data, rendered as trailing muted text directly after the workspace name (same slot/weight as the existing `notionAccountLabel` hint, not a new line): "🔗 N מקושרים" or "אין קישור Notion" when zero — so mapping state is visible without opening the modal, without adding row height.

### 3. New settings page `/settings/notion-statuses` (`apps/web/src/app/settings/notion-statuses/page.tsx`)

- Table of every raw Notion status label seen (`notionStatusOverrides.unmapped` merged with `notionStatusOverrides.list`): columns are the raw label, task count, and a status chip-picker (5 chips, same visual language as `TaskModal` priority chips, in the fixed order `not_started → in_progress → blocked → done → cancelled`) showing the current resolution (override if set, else the heuristic guess, visually marked "(שיוך אוטומטי)" when unconfirmed). Picking a chip calls `upsert`; a "נקה מיפוי" ghost button per row (visible only when an override exists) calls `delete`, reverting to the heuristic guess.
- Responsive: below the `sm` breakpoint the table collapses into one stacked card per raw label (label + count on top, the 5 status chips wrapping below, full width) instead of horizontal columns, matching the card-based mobile pattern already used elsewhere in the app.
- Empty state: "אין עדיין סטטוסים מיובאים מ-Notion — סנכרן משימות כדי להתחיל." with no CTA button (sync lives on `/tasks`).
- Add a settings card linking here from `apps/web/src/app/settings/page.tsx`, next to the existing workspaces card.

### 4. `TaskModal` (`apps/web/src/components/Modals/TaskModal.tsx`)

- Add a "סטטוס" chip row using `STATUS_LABELS` / `STATUS_COLORS` from `@ak-system/types`, placed above the existing "עדיפות" chips, same interaction style (click sets `form.status`), chips rendered in the fixed order `(['not_started','in_progress','blocked','done','cancelled'] as const)` — mirrors how priority chips already use a fixed `(['high','medium','low'] as const)` order. Defaults to `'not_started'` for new tasks, prefills from `editingTask.status` when editing. Include `status` in both mutation payloads.

### 5. `/tasks` (`apps/web/src/app/tasks/page.tsx`)

- Add a small `StatusPill` component (`apps/web/src/components/StatusPill.tsx`, mirrors `WorkspacePill`: colored dot + `STATUS_LABELS[status]`) rendered on each `.task-row`, but only when `status` is `in_progress`, `blocked`, or `cancelled` — the existing `.checkbox-btn` already conveys plain not-started/done, so the pill only appears to add information, keeping the row uncluttered for the common case.
- The `.checkbox-btn` quick-toggle keeps its current visual and calls the same `toggleTask` mutation (now flipping `status` server-side too); no changes to the three-tab open/done/all filter, which continues to read the derived `done` flag.

## Out of Scope

- No changes to `apps/web/src/lib/notion-config.ts`, the separate Notion config reader used by other features (meeting prep, etc.) — the two config resolvers stay independent.
- No automatic provisioning of a Notion database for DAZ. Legacy `NOTION_API_KEY` mode only exposes 3 hardcoded databases (`Personal To-do`, `DT - Action items`, `Con Action items`); giving DAZ a real Notion source requires Alpir to add a `NOTION_ACCOUNTS` entry with DAZ's actual database id and token in the production env — an operational step outside this spec (see Open Questions).
- No write-back to Notion: canonical status changes made locally (via `TaskModal` or `toggleDone`) are never pushed to the Notion page's status property.
- No redesign of the tasks page's 3-tab status filter (open/done/all) into a 5-value filter; the new granularity is visible via the status chip in `TaskModal` and the `StatusPill`, not a new filter row.
- No per-workspace or per-database status-label overrides — `notionStatusOverrides` is global, since the same raw label (e.g. "In Progress") means the same thing across every Notion source.
- No change to the Notion sync window (`windowDays`, default 60), pruning, or people-matching logic beyond removing the done-page skip.
- No automatic re-sync trigger after linking/unlinking a database — Alpir still clicks the existing "סנכרן מ-Notion" button on `/tasks`.

## Open Questions

- **Resolved:** removing the done/cancelled skip in Notion sync is confirmed wanted — Alpir wants done/cancelled Notion tasks from the last 60 days to keep showing up locally with their real status, not be hidden. No further confirmation needed; proceed as specced.
- DAZ has no Notion database configured at all today (see Out of Scope) — adding it is an operational step (real Notion database id + a token with access to it, wired into `NOTION_ACCOUNTS`), not something this spec's code can do on its own. Pending Alpir confirming where DAZ's Notion tasks database lives (same integration as the existing 3 databases, or a separate Notion workspace needing a new integration/token) before writing the exact env-config steps.
