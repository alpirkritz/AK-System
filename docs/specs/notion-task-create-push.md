# Spec — push new tasks into their workspace's linked Notion database

**Slug:** `notion-task-create-push`
**Stack:** `next-trpc-monorepo`
**Depends on:** `docs/specs/notion-writeback-and-mobile-tasks.md` (status write-back), `docs/specs/notion-workspace-mapping.md` (workspace ↔ database links)

## Problem

Status changes now write back to Notion, but task **creation** is still one-directional: `tasks.create` only ever inserts a local row with `source: 'manual'`. Picking the DAZ workspace when creating a task in ARO does not create anything in the DAZ Tasks Notion database — confirmed by inspecting the router (no `POST /v1/pages` call exists anywhere in the codebase) and by the user's direct question after using it.

## Approach

When a task is created with a `workspaceId` that has a linked Notion database (`workspaceNotionDatabases`), best-effort create a page in that database immediately after the local insert, then attach the resulting `notionPageId` to the local row so status write-back and future sync treat it exactly like a Notion-sourced task.

**Local-first, same as write-back:** the local row is the source of truth and is never rolled back if Notion fails. A failed push leaves the task as an ordinary manual task (`source: 'manual'`, no `notionPageId`) — never a half-linked state with a `notionPageId` that doesn't exist.

### Target resolution

New `resolveWorkspaceNotionTarget(workspaceId)` in `notion-tasks-sync.ts`:
1. Read `workspaceNotionDatabases` rows for `workspaceId`, ordered by `createdAt`.
2. If none, return `null` (task stays local-only — the common case for workspaces with no Notion link, e.g. plain "Personal" tasks without a linked database, or no workspace at all).
3. Take the **first** linked row and match its `notionDatabaseId` against `resolveDatabases('tasks')` to get `{ token, accountLabel, name }`. If the token/account is no longer configured, return `null`.
4. A workspace linked to more than one database uses only the first (by link creation order) — documented limitation, not a UI choice in v1 (see Out of Scope).

### Page creation

New `createNotionTask` in `notion-task-writeback.ts`:
1. Fetch the database schema (`GET /v1/databases/{id}`, same 5-minute cache as write-back) and extract: the `title`-type property name (Notion requires exactly one), the status property (`findStatusPropertyName`, reused), and the first `date`-type property (best-effort due date target).
2. Build `properties`: title always; status property set via `pickNotionLabel('not_started', ...)` (falls back to omitting the property if no option maps to `not_started` — Notion pages default to no status rather than a wrong one); date property set from `dueDate` when both a target property and a value exist.
3. `POST /v1/pages` with `parent: { database_id }` and the built properties.
4. Return `{ ok: true, pageId, accountLabel, name, label }` or the same `WriteBackFailure` shape as status write-back (`account`, `api`; `no-status-property`/`no-matching-option` do not fail page creation — status is optional on create, unlike on update).

### Router integration (`tasks.create`)

After the existing local insert:
```
if (input.workspaceId) {
  const target = await resolveWorkspaceNotionTarget(input.workspaceId)
  if (target) {
    const pushed = await createNotionTask({ target, title, dueDate, status })
    if (pushed.ok) {
      update the row: source: 'notion', notionPageId, notionAccount: target.accountLabel,
        notionDb: target.name, notionStatusRaw: pushed.label ?? null
    }
    notionSync = pushed
  }
}
return { ...row, notionSync }
```
`notionSync` is `null` when the workspace has no Notion link (the common case), matching the existing convention from status write-back.

### Priority and other fields — out of scope for v1

Priority has no established raw-label heuristic (unlike status, which already has `guessCanonicalStatus`), and guessing wrong writes a misleading value into Notion. Title, status, and due date only for v1; priority, assignee, and any other Notion property are not pushed.

## Router & Data changes

- `packages/api/src/services/notion-tasks-sync.ts`: export `resolveWorkspaceNotionTarget`.
- `packages/api/src/services/notion-task-writeback.ts`: export `createNotionTask`; refactor `fetchStatusSchema` into a shared `fetchDatabaseSchema` that also returns the title-property name and the first date-property name, keeping the existing 5-minute cache.
- `packages/api/src/routers/tasks.ts`: `create` gains the push-then-attach flow above. Return type gains `notionSync` (same shape used by `update`/`toggleDone`).
- No schema migration needed — `source`, `notionPageId`, `notionAccount`, `notionDb`, `notionStatusRaw` already exist on `tasks`.

## UI Surface

Both task-creation entry points already collect `workspaceId`, so this is additive feedback, not new fields:

- **`TaskModal`** (new-task mode) and **`QuickAddTaskModal`**: when the selected workspace has a linked Notion database (from `trpc.workspaces.list`'s existing `notionDatabases` field — already returned per workspace, no new query needed), show the same discoverability hint pattern already used for editing Notion tasks: "המשימה תיווצר גם ב-Notion ({workspace name})". Hint updates live as the workspace selection changes; hidden when the chosen workspace has no link.
- On failed push (`notionSync.ok === false`): both modals still close (the task was created — failing to also push to Notion is not blocking), but show a one-line toast/inline notice "המשימה נשמרה, אבל לא נוצרה ב-Notion" via the same inline-error slot each modal already has for its create mutation's `onError`.
- **Mobile** (`apps/mobile/app/task/[id].tsx`): the create flow already calls the same `tasks.create` procedure with `workspaceId`, so the push itself needed zero backend changes to reach mobile — only the client needed to surface it. `MobileWorkspace` gains the `notionDatabases` field (mirrors the web shape from `trpc.workspaces.list`) and `createTask`'s return type gains `notionSync`. The create screen shows the same "המשימה תיווצר גם ב-Notion ({workspace name})" hint below the workspace chips when the selected workspace is linked, and on a failed push shows the same inline error pattern already used for a failed status write-back on `update` ("המשימה נשמרה, אבל לא נוצרה ב-Notion"), then dismisses after a beat.

## Out of Scope

- Priority, assignee, or custom-property push.
- UI to pick which of several linked databases receives a new task when a workspace has more than one link (first-linked wins).
- Retrying a failed create-push automatically; the task simply stays manual and behaves like any other manual task (editable, but its status changes never write back since it has no `notionPageId`).
- Changing `tasks.update`'s behavior for manual tasks — this spec only adds Notion pushes at creation time.

## Acceptance Criteria

- [ ] Creating a task with a workspace that has **no** Notion link never calls the Notion API; `notionSync` is `null`.
- [ ] Creating a task with a workspace linked to a Notion database creates a real page there with the title and a `not_started`-equivalent status (per that database's own options).
- [ ] A due date on the created task is written to the database's first date property, if one exists.
- [ ] If Notion push fails for any reason, the task still exists locally as an ordinary manual task — no `notionPageId` is stored, `source` stays `'manual'`.
- [ ] The follow-up status write-back and pull-sync both work unmodified on a task created this way (it looks identical to a task that was originally pulled from Notion).
- [ ] `pnpm test`, mobile `tsc --noEmit`, and `pnpm --filter @ak-system/web build` all pass.
