# Review — Push new tasks into their workspace's linked Notion database

**Slug:** `notion-task-create-push`
**Spec:** `docs/specs/notion-task-create-push.md`

## Summary

Answers the user's question — "if I create a task in ARO, does it land in the right Notion database?" — which was **no** before this change (task creation was local-only; no `POST /v1/pages` call existed anywhere in the codebase). Creating a task with a `workspaceId` that has a linked Notion database now best-effort creates a page there (title, an initial `not_started`-equivalent status, and a due date when a date property exists), then attaches the resulting `notionPageId`/`notionAccount`/`notionDb` to the local row — after which the existing status write-back and pull-sync treat it exactly like a task that was originally pulled from Notion.

## Implementation

- `packages/api/src/services/notion-tasks-sync.ts`: `resolveWorkspaceNotionTarget(workspaceId)` — reads `workspaceNotionDatabases`, resolves the token/account via the existing `resolveDatabases('tasks')`.
- `packages/api/src/services/notion-task-writeback.ts`: `fetchStatusSchema` refactored into a shared `fetchDatabaseSchema` (adds title-property and first date-property detection, same 5-minute cache) and `createNotionTask` (`POST /v1/pages`, never throws).
- `packages/api/src/routers/tasks.ts`: `create` pushes-then-attaches when a link is resolvable; returns `notionSync` (same convention as `update`/`toggleDone`).
- Web UI: `TaskModal` and `QuickAddTaskModal` show "המשימה תיווצר גם ב-Notion ({workspace})" when the selected workspace has a link, and surface a one-line notice ("...אבל לא נוצרה ב-Notion") on push failure via each screen's existing message/toast slot (`tasks/page.tsx`'s `syncMessage`, `DashboardLayout`'s FAB toast). `meetings/[id]` and `projects/[id]` get the hint only (no local toast slot existed there — logged as a minor known gap, not blocking, since task creation itself never fails).
- Mobile: `apps/mobile/app/task/[id].tsx` create flow already called `tasks.create` with `workspaceId`, so the server-side push required **zero backend changes** to reach mobile. Added the same hint + failure-notice pattern used on `update`'s Notion write-back (`MobileWorkspace.notionDatabases`, `createTask`'s `notionSync` return).

## QA

- `pnpm --filter @ak-system/api test`: **224/224 passed** (22 new: `createNotionTask` unit tests + `tasks.create` Notion-push integration tests covering no-workspace, no-link, successful push+attach, and failure-keeps-manual).
- `pnpm --filter @ak-system/web test`: 64/64 passed (unaffected).
- `AK_DEPLOY_BUILD=1 pnpm --filter @ak-system/web build`: green.
- `pnpm -r run lint`: `apps/mobile` and `apps/whatsapp-bridge` (`tsc --noEmit`) green; `apps/web`'s `next lint` fails to run non-interactively in this environment (no committed `.eslintrc`, prompts for initial ESLint setup) — **pre-existing environment gap, unrelated to this change**, not introduced here.

## Verdict

**APPROVED WITH NITS**

Nits (non-blocking):
1. `next lint` cannot run non-interactively in this workspace (missing committed ESLint config) — pre-existing, worth fixing separately since it silently skips web lint in every pipeline run.
2. `meetings/[id]` and `projects/[id]` task-creation entry points show the "will also create in Notion" hint but have no failure-toast slot for a push that fails — acceptable since the task is never lost, just not mirrored; a future pass could add a shared toast.
3. Mobile priority/other-field push parity matches web exactly (title + status + due date only) — same intentional v1 scope, not a gap.
