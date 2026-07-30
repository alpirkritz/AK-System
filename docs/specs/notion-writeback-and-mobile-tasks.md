# Spec — two-way Notion status sync + mobile tasks parity

**Slug:** `notion-writeback-and-mobile-tasks`
**Stack:** `next-trpc-monorepo` (+ `apps/mobile`, Expo SDK 56 / RN 0.85)
**Depends on:** `docs/specs/task-status-pending-and-ux.md`

## Problem

Two gaps found after the status work shipped:

1. **Notion is read-only.** There is no `PATCH /v1/pages/...` call anywhere in the repo — every Notion
   call is `POST /v1/databases/{id}/query`. Marking a task done in the app never reaches Notion, and
   the sync's update path overwrites `status`, `done`, `title`, `priority`, `dueDate` and `assigneeId`
   from Notion (`notion-tasks-sync.ts:601`). The user's action is silently discarded on the next sync.
2. **The mobile app never received the last two features.** `MobileTask` (`apps/mobile/lib/data.ts:11`)
   carries only `done`/`priority`/`dueDate` — no `status`, no `workspaceId`. The tasks screen filters on
   the boolean, so cancelled tasks show under "הושלמו" with a ✓ — the same bug just fixed on web.
   There is no way to see a task's details or to create a task from the phone.

## Part 1 — Two-way status sync

### Approach

Notion status option sets are per-database and arbitrary (DAZ uses
`Pending / Not Started / In Progress / Testing / Done / Archived`). We must translate a canonical
status back into *that database's* literal label, which is the inverse of the read path.

New service `packages/api/src/services/notion-task-writeback.ts`:

| Function | Responsibility |
|---|---|
| `resolveTaskDatabaseTarget(accountLabel, dbName)` | token + `databaseId` for a synced task (exported from `notion-tasks-sync.ts`, reusing `resolveDatabases('tasks')`) |
| `findStatusProperty(dbSchema)` | the writable status property — same precedence as the read path: real `status` type first, then a `select` named status/סטטוס, never a priority property |
| `pickNotionLabel(canonical, options, overrides)` | first option whose resolved canonical equals the target, using the user's overrides then the keyword guess |
| `pushTaskStatus({...})` | `PATCH /v1/pages/{pageId}` with `{ properties: { [name]: { status \| select: { name } } } }` |

The database schema is fetched with `GET /v1/databases/{id}` and cached in-module for 5 minutes, so a
rapid series of checkbox taps does not issue a schema request each time.

### Router integration

`tasks.toggleDone` and `tasks.update` (only when `status` actually changes) attempt write-back when the
task has `source === 'notion'` and a `notionPageId`.

- The local write always happens first and is never rolled back — the phone must stay responsive even
  if Notion is unreachable.
- On success the local `notionStatusRaw` is set to the label we wrote, so the UI and the next sync agree.
- Both mutations return an extra `notionSync: { ok: true, label } | { ok: false, reason } | null`
  (`null` for manual tasks). Failures surface in the UI instead of vanishing into a log.

### Failure modes

| Case | Behaviour |
|---|---|
| No configured account matches the task's `notionAccount` | `{ ok: false, reason: 'account' }` |
| Database exposes no status/select property | `{ ok: false, reason: 'no-status-property' }` |
| No option maps to the target canonical status | `{ ok: false, reason: 'no-matching-option' }` — e.g. a database with no "cancelled"-like option |
| Notion returns non-2xx (permissions, archived page) | `{ ok: false, reason: 'api' }`, message truncated |

Writing `pending` to the DAZ database resolves to `Pending`; `in_progress` resolves to `In Progress`
(not `Testing`, because option order is preserved and `In Progress` comes first).

### Out of scope

- Writing title, due date, priority or assignee back to Notion — status only.
- Creating or deleting Notion pages from the app.
- Real-time push from Notion (still pull-based sync).

## Part 2 — Mobile tasks parity

### Data layer

`MobileTask` gains `status`, `workspaceId`, `assigneeId`, `source`, `notionPageId`, `notionStatusRaw`.
New `MobileWorkspace` type plus `fetchWorkspaces`, `fetchTask`, `createTask`, `updateTask` wrappers.
No server work is required — mobile already calls the same tRPC procedures, which return these fields.

Status constants (`STATUS_COLOR`, `STATUS_LABEL`, `STATUS_ORDER`) are duplicated into
`apps/mobile/lib/theme.ts`, matching the existing precedent for `PRIORITY_COLOR`/`PRIORITY_LABEL`.
Mobile deliberately does not depend on `@ak-system/types` — adding a workspace package to the Metro
bundler is a build risk that duplicating six labels does not justify.

### UI Surface

**Tasks list** (`app/(tabs)/tasks.tsx`)

- Status tabs **פתוחות / הושלמו / בוטלו / הכל**, evaluated on the effective status, mirroring web.
- Source (workspace) filter chips, shown only when workspaces exist — mirrors the web chip row.
- A status pill per row, silent for `not_started` and `done` (same rule as web `StatusPill`).
- **Split tap targets.** Today the whole row toggles done, so trying to inspect a task completes it
  instead. The checkbox becomes its own ≥44px target; pressing anywhere else opens the detail sheet.
- **FAB** bottom-left (RTL mirror of the web `.fab`), 56px, turquoise, sitting above the tab bar with
  safe-area inset. Opens the detail sheet in create mode.

**Task detail sheet** (`app/task/[id].tsx`, `presentation: 'formSheet'`)

`id === 'new'` means create; any other id loads that task. Fields: title, status chips, priority
chips, due date, source. Uses expo-router's native `formSheet` with `sheetAllowedDetents: 'fitToContents'`
and a visible grabber, so swipe-to-dismiss works as the platform expects.

- Notion-sourced tasks show "מסונכרן עם Notion — שינוי סטטוס יעודכן גם שם" so the write-back is
  discoverable rather than invisible.
- Save is disabled while the title is empty or a mutation is pending; errors render in Hebrew above
  the buttons; the list refreshes on dismiss.

### Out of scope (mobile)

- Assignee and related-people pickers, project/meeting linking, task deletion.
- Editing Notion status mapping from the phone (settings screen stays web-only).

## Acceptance criteria

- [ ] Marking a Notion task done in the app sets its Notion `Status` to that database's done-like option.
- [ ] A status with no counterpart option reports a reason instead of failing silently.
- [ ] Manual (non-Notion) tasks perform no network call and return `notionSync: null`.
- [ ] A Notion failure still leaves the local status updated.
- [ ] Mobile: cancelled tasks appear under "בוטלו", never "הושלמו".
- [ ] Mobile: tapping a row opens details; only the checkbox toggles completion.
- [ ] Mobile: the FAB creates a task with title, status, priority, due date and source.
- [ ] `pnpm test` green; mobile `tsc --noEmit` green; web build green.

## Files

| File | Change |
|---|---|
| `packages/api/src/services/notion-task-writeback.ts` | new service |
| `packages/api/src/services/notion-tasks-sync.ts` | export `resolveTaskDatabaseTarget`, share status-property lookup |
| `packages/api/src/routers/tasks.ts` | write-back hook in `toggleDone` / `update` |
| `packages/api/src/services/notion-task-writeback.test.ts` | new tests |
| `apps/mobile/lib/data.ts`, `lib/theme.ts`, `lib/task-status.ts` | data + constants |
| `apps/mobile/app/(tabs)/tasks.tsx` | filters, pills, split targets, FAB |
| `apps/mobile/app/task/[id].tsx`, `app/_layout.tsx` | detail sheet + route registration |
