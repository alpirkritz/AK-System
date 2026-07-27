# Task Workspaces (מקורות) + Global Quick-Add

> **Slug:** `task-workspaces`
> **Status:** Draft
> **Detected stack:** `next-trpc-monorepo`
> **Last Updated:** 2026-07-27

## Goal

Alpir tracks tasks that belong to several distinct contexts — Alpir Consulting, Dragontail, DAZ, and Personal — but the system today only groups tasks by lightweight `projects`. Introduce a first-class **Workspace (מקור)** dimension, orthogonal to projects, so every task carries its origin. Tasks become filterable and color-coded by workspace in one unified view, Notion-synced tasks are auto-mapped to a workspace by a user-configured label, and a persistent global quick-add button lets Alpir capture an ad-hoc task from any screen without losing his place.

## User Stories

- As Alpir, I want each task to belong to a workspace (Alpir Consulting / Dragontail / DAZ / Personal) so I can see where every task comes from.
- As Alpir, I want to filter the tasks list by workspace so I can focus on one context at a time, or see everything together.
- As Alpir, I want each task row to show a color-coded workspace tag everywhere it appears (tasks page, project detail, meeting detail, person drawer) so origin is obvious at a glance.
- As Alpir, I want Notion-synced tasks to land in the right workspace automatically, based on their Notion account/database label, so I do not have to sort them by hand.
- As Alpir, I want to add a quick task from anywhere in the app via a floating button, entering just a title and a workspace, so capture is frictionless.
- As Alpir, I want to manage my workspaces (add, rename, recolor, set the Notion mapping label, delete) so the list matches my real contexts over time.

## Acceptance Criteria

- [ ] A `workspaces` table exists in both SQLite and Postgres schemas with `id`, `name`, `color`, `notionAccountLabel`, `createdAt`, `updatedAt`.
- [ ] `tasks.workspaceId` (nullable FK → `workspaces.id`, `onDelete: 'set null'`, indexed) exists in both schemas.
- [ ] On first boot the DB is seeded with 4 workspaces: Alpir Consulting, Dragontail, DAZ, Personal (idempotent — re-running does not duplicate).
- [ ] `workspaces` tRPC router exposes `list`, `getById`, `create`, `update`, `delete`; `delete` nulls `tasks.workspaceId` for affected rows before removing the workspace.
- [ ] `tasks.create` and `tasks.update` accept and persist `workspaceId`; `tasks.list` accepts an optional `workspaceId` filter and returns all tasks when omitted (preserving current behavior).
- [ ] `tasks.listByWorkspace` returns only tasks for a given workspace id.
- [ ] Notion sync sets `workspaceId` on each synced task by matching (case-insensitive, trimmed) the task's `notionDb` OR `notionAccount` against a workspace's `notionAccountLabel`; unmatched tasks keep `workspaceId = null`.
- [ ] `/tasks` shows a workspace filter (chips) and every task row shows a color-coded workspace pill (or a "לא משויך" pill when null).
- [ ] The `TaskModal` includes a workspace picker; the value is saved on create/edit.
- [ ] A floating quick-add button is visible on every authenticated route (desktop + mobile), opens a lightweight modal (title autofocus + workspace picker; other fields collapsed), and creates the task via `tasks.create`.
- [ ] A workspace-management screen at `/settings/workspaces` supports add/rename/recolor/set-label/delete.
- [ ] Vitest covers the workspaces router + Notion mapping; Playwright covers the quick-add flow and workspace filter; `pnpm --filter @ak-system/web build` and `pnpm -r run lint` pass.

## Data Model

Changes to **`packages/database/src/schema.ts`** (SQLite) AND **`packages/database/src/schema.pg.ts`** (Postgres) — additive, no breaking changes.

### New table `workspaces` (mirror `projects` + one extra column)

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | e.g. `ws_...` |
| `name` | text, not null | display name |
| `color` | text, default `#2dd4bf` | tag color |
| `notionAccountLabel` | text, nullable | user-set; matched against synced task's `notionDb` / `notionAccount` for auto-mapping |
| `createdAt` | text, not null | ISO |
| `updatedAt` | text, not null | ISO |

No index required beyond the PK.

### `tasks` — add one column (both schemas)

- `workspaceId`: `text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' })`, nullable.
- Add index `idx_tasks_workspace_id` on `tasks(workspaceId)`.

Because `tasks` references `workspaces`, declare `workspaces` **before** `tasks` in both schema files (as `projects` already is).

### Migration / bootstrap (`packages/database/src/index.ts`)

Production and dev both run SQLite (`DATABASE_PATH`), migrated by the idempotent bootstrap in `getDb()`. Add:

- A `WORKSPACES_TABLE` array with `CREATE TABLE IF NOT EXISTS workspaces (...)` and run it in the SQLite bootstrap loop.
- Extend `TASKS_COLUMNS` with `ALTER TABLE tasks ADD COLUMN workspace_id TEXT` and `CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id)`.
- A seed step: insert the 4 default workspaces with **fixed ids** (`ws_alpir_consulting`, `ws_dragontail`, `ws_daz`, `ws_personal`) using `INSERT OR IGNORE` (idempotent). Suggested colors: Alpir Consulting `#2dd4bf`, Dragontail `#fb7185`, DAZ `#38bdf8`, Personal `#b847e8`. Leave `notionAccountLabel` empty (user sets it in the UI).
- Export `workspaces` from `packages/database/src/index.ts` (both the `schema.workspaces` runtime export and `Workspace` / `NewWorkspace` types), following the existing export pattern.

Postgres parity is maintained in `schema.pg.ts`; if a Postgres deployment is ever used, the table + column are created via `drizzle-kit push` (same as the rest of the pg schema).

## tRPC API

All procedures are `protectedProcedure` (auth required), matching existing routers.

### New router `packages/api/src/routers/workspaces.ts` (mirrors `projects.ts`), mounted as `appRouter.workspaces` in `packages/api/src/index.ts`

| Procedure | Kind | Input (Zod) | Returns |
|---|---|---|---|
| `list` | query | none | `Workspace[]`, ordered by `name` |
| `getById` | query | `{ id: string }` | `Workspace \| null` |
| `create` | mutation | `{ name: string(min 1), color?: string, notionAccountLabel?: string }` | created `Workspace` |
| `update` | mutation | `{ id: string, name?: string, color?: string, notionAccountLabel?: string \| null }` | updated `Workspace \| null` |
| `delete` | mutation | `{ id: string }` | `{ ok: true }` — first `update(tasks).set({ workspaceId: null }).where(eq(tasks.workspaceId, id))`, then delete the workspace |

### Extend `packages/api/src/routers/tasks.ts`

- `createInput` + `updateInput`: add `workspaceId: z.string().nullable().optional()`. Persist it in `create` (insert) and `update` (only when provided). In `create`, default to `null` when omitted.
- `list`: accept optional input `z.object({ workspaceId: z.string().optional() }).optional()`; when `workspaceId` is present, filter `where(eq(tasks.workspaceId, input.workspaceId))`, else return all (unchanged default so existing callers with no args still work).
- Add `listByWorkspace: protectedProcedure.input(z.object({ workspaceId: z.string() })).query(...)` returning tasks for that workspace.

### Extend Notion sync `packages/api/src/services/notion-tasks-sync.ts`

- After loading people maps, load workspaces once: `select({ id, notionAccountLabel }).from(workspaces)` and build a case-insensitive `Map<label, workspaceId>` (skip null/empty labels).
- Add a helper `resolveWorkspaceId(db, account)` that returns the workspace id whose `notionAccountLabel` matches (case-insensitive, trimmed) either `database.name` (the `notionDb`) or `database.accountLabel` (the `notionAccount`); prefer the `notionDb` match. Returns `null` when no match.
- Set `workspaceId` in both the insert branch and the update branch of the tasks pass (alongside `notionAccount` / `notionDb`).
- Behavior is fully backward compatible: with no configured labels, all synced tasks get `workspaceId = null`.

## UI Surface

RTL Hebrew, dark theme. Reuse existing utility classes: `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-ghost`, `.input`, `.select`, `.label`, `.card`, `.overlay` + `.modal`, `.pill`, `.filter-chip`, `.task-row`, `.checkbox-btn`. Colors from `apps/web/src/app/globals.css` `:root`.

### 1. Workspace pill (shared visual)

A small color-coded tag rendered from a workspace's `color` + `name` (same visual language as the existing project `.pill`, e.g. a filled dot + name). When a task has `workspaceId = null`, render a muted "לא משויך" pill. Used on every task-rendering surface below. Implement as a tiny presentational component (e.g. `apps/web/src/components/WorkspacePill.tsx`) to avoid duplication.

### 2. `/tasks` (`apps/web/src/app/tasks/page.tsx`)

- Add `trpc.workspaces.list.useQuery()`.
- Add a workspace filter row of `.filter-chip`s: "הכל" + one chip per workspace (chip accent tinted to the workspace color when pressed). Keep existing status chips, search, project and meeting selects. Filtering stays client-side (consistent with current implementation): a task matches when its `workspaceId` equals the selected chip.
- Render the workspace pill on each `.task-row` (next to / before the existing project pill).
- Empty-state and loading-state copy unchanged; the "+ משימה חדשה" button and `TaskModal` continue to work, now with the workspace field.

### 3. `TaskModal` (`apps/web/src/components/Modals/TaskModal.tsx`)

- Accept a `workspaces: { id: string; name: string }[]` prop and an optional `workspaceId?: string | null` prefill prop (used by the quick-add and by context screens).
- Add a "מקור" `<select>` (options: "ללא מקור" + workspaces) above or beside the "פרויקט" field.
- Include `workspaceId` in the `create` / `update` mutation payloads. Prefill from the editing task on edit.
- Callers (`/tasks`, `/projects/[id]`, `/meetings/[id]`) pass the workspaces list.

### 4. Global quick-add — FAB + `QuickAddTaskModal`

- New component `apps/web/src/components/QuickAddTaskModal.tsx`: uses `.overlay` + `.modal`; fields:
  - Title `input` (autofocus, required, placeholder "מה צריך לעשות?"). Enter submits.
  - Workspace picker (`.select` or chips) — default to the last-used workspace, persisted client-side in `localStorage` (key e.g. `ak.quickAdd.workspaceId`).
  - Collapsed "עוד פרטים" disclosure revealing optional due date + priority (reuse the priority chips from `TaskModal`).
  - Actions: "ביטול" (`.btn-ghost`) + "הוסף" (`.btn-primary`, disabled until title non-empty / while pending).
  - On success: invalidate `tasks.list`, close, and show a brief confirmation (toast or inline "נוספה משימה"). Focus returns to the FAB. Default workspace when `localStorage` is empty is Personal (פרטי), not "ללא מקור".
  - On error: keep the modal open with the typed title intact and show an inline error (reuse the `ProjectModal` error style) with copy "לא הצלחנו להוסיף את המשימה. נסה שוב." — do NOT close on error.
  - Modal traps focus and closes on `Escape` and overlay click.
- New FAB rendered inside `DashboardLayout` (`apps/web/src/components/DashboardLayout.tsx`), hidden on `/login`:
  - Fixed circular "+" button, ≥ 44×44px touch target, accent background (`--accent`), `aria-label="הוסף משימה"`, `focus-visible` ring.
  - Desktop: **bottom-left** corner (RTL-safe, away from page CTAs and the top `NotificationBell`). Mobile: positioned above the ~56px bottom nav (`bottom: calc(56px + env(safe-area-inset-bottom) + 12px)`) and **hidden while the "עוד" drawer (`moreOpen`) is open** to avoid z-index/tap conflicts.
  - Opens `QuickAddTaskModal`. FAB motion respects `prefers-reduced-motion`.
- Add a `.fab` class to `globals.css` (or Tailwind inline) matching the design tokens.

### 5. Other task surfaces (workspace pill only, no new logic)

- `apps/web/src/app/projects/[id]/page.tsx`, `apps/web/src/app/meetings/[id]/page.tsx`, and `apps/web/src/components/people/PersonDetailDrawer.tsx`: render the shared workspace pill on task rows. These screens already load tasks; add `workspaces.list` and map by `workspaceId`.

### 6. Workspace management — `/settings/workspaces`

- New route `apps/web/src/app/settings/workspaces/page.tsx`, following the `/projects` + `ProjectModal` pattern.
- List each workspace (color dot + name + `notionAccountLabel` hint) with edit / delete actions and a "+ מקור חדש" button.
- New `apps/web/src/components/Modals/WorkspaceModal.tsx` (mirrors `ProjectModal`): fields name, color swatches, and a "תווית Notion" text input with helper text ("למיפוי אוטומטי ממשימות Notion — שם מסד הנתונים או החשבון").
- Delete requires confirmation ("למחוק את המקור? המשימות יישארו אך יאבדו את השיוך."). Add a link/card to this page from the main `/settings` page.

## Out of Scope

- Assigning existing (already-synced or legacy) tasks to workspaces in bulk beyond the Notion label auto-mapping (they remain `null` / "לא משויך" until edited or re-synced).
- Adding `workspaceId` to meetings, projects, or people.
- Nesting projects under workspaces via a FK (workspaces and projects stay independent dimensions; a task can have both).
- Per-workspace permissions, sharing, or multi-user scoping.
- Server-side pagination or moving the tasks-list filtering to the server (filtering stays client-side).
- A command-palette / keyboard-shortcut quick-add (FAB only per user decision).
- Changing the Notion sync windowing, pruning, or people-matching logic.

## Open Questions

- None. (Default workspace names/colors and the Notion label mapping approach are specified above; the label mapping is user-editable, so the ambiguous DAZ↔Dragontail Notion relationship is resolved by the user in `/settings/workspaces` rather than hardcoded.)
