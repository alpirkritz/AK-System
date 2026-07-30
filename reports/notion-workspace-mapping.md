# Review — Notion Workspace Mapping & Rich Task Status

Spec: `docs/specs/notion-workspace-mapping.md`
Stack: `next-trpc-monorepo`
Reviewer gate: lint + build + spec conformance
Date: 2026-07-30

## Verdict: APPROVED WITH NITS

Implementation matches the approved spec. API suite green (200/200), web build green. Nits below are non-blocking.

## Static checks

- `pnpm --filter @ak-system/api test` — ✅ 200 passed.
- `pnpm --filter @ak-system/web build` — ✅ compiled; `/settings/notion-statuses` route generated.
- `pnpm -r run lint` — mobile + whatsapp-bridge `tsc --noEmit` ✅. `apps/web` `next lint` fails because ESLint has never been initialized in the repo (interactive setup prompt). Pre-existing and environmental — not introduced here.

## Spec conformance

Data model — `packages/database/src/schema.ts:65`, `schema.pg.ts:60`, `index.ts`:
- `workspace_notion_databases` (unique `notion_database_id`) and `notion_status_overrides` (unique `raw_label`) added to both SQLite and Postgres schemas.
- `tasks.status` (default `not_started`) and `tasks.notion_status_raw` added; SQLite bootstrap ALTERs + idempotent backfill `UPDATE tasks SET status='done' WHERE done=1 AND status='not_started'`.
- Runtime + type exports wired in `packages/database/src/index.ts` (`TASK_STATUSES`, `WorkspaceNotionDatabase`, `NotionStatusOverride`).

Types — `packages/types/src/index.ts:22`: `STATUS_COLORS`, `STATUS_LABELS`, `TASK_STATUS_ORDER`, `TaskStatus`. `cancelled` uses muted purple `#9a7bc4` (distinct from the grey unassigned pill), per UI review.

API:
- `workspaces.ts` — `listNotionDatabases`, `linkNotionDatabase` (CONFLICT on cross-workspace claim, idempotent same-workspace), `unlinkNotionDatabase`; `list`/`getById` include `notionDatabases`; `delete` cleans links.
- `notion-status-overrides.ts` — `list` / `upsert` (one row per label) / `delete` / `unmapped` (distinct labels + counts + guess, overridden excluded); mounted in `appRouter`.
- `tasks.ts` — `status` on create/update; `done` derived and kept in lockstep; `toggleDone` sets status.
- `notion-tasks-sync.ts` — `listConfiguredTaskDatabases`, `getStatusRaw`, `guessCanonicalStatus`, `resolveCanonicalStatus`; ID-first `resolveWorkspaceId`; `isDone` early-skip removed so done/cancelled tasks sync and display.

UI:
- `WorkspaceModal` — Notion DB-link checklist with pending ("מעדכן…"), error (`role="alert"`), disabled-while-claimed states; legacy label relabeled "תווית Notion (גיבוי)".
- `/settings/workspaces` — link-count caption ("🔗 N מקושרים").
- `/settings/notion-statuses` — mapping table with `StatusChips` picker, per-label task counts, "שיוך אוטומטי" hint, clear-override; responsive stacked layout on mobile. Settings card added.
- `TaskModal` — "סטטוס" chips row in canonical order. `StatusPill` on `/tasks` rows for non-`not_started` statuses.

## Nits (non-blocking)

1. `StatusPill` is wired on `/tasks` only. The spec mentioned consistency across `projects/[id]`, `meetings/[id]`, and the person drawer; the plan scoped this node to `/tasks`. Consider a follow-up to add it to those surfaces (they already render `WorkspacePill`).
2. `/settings/workspaces` caption uses a small inline cast (`w as { notionDatabases?: unknown[] }`). Harmless, but a shared workspace type with `notionDatabases` would be cleaner.
3. No Playwright e2e added for the new mapping/link flows — recommend a smoke spec when convenient.

## Manual step (outside code)

DAZ lives in a separate Notion workspace: create its integration, share the DB, add it to `NOTION_ACCOUNTS`, and migrate production off legacy `NOTION_API_KEY`. Once configured, the DAZ databases appear automatically in the WorkspaceModal picker.
