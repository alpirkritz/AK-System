# Review — Notion Tasks + People Sync (60-day)

> **Slug:** `notion-tasks-people-sync`
> **Spec:** `docs/specs/notion-tasks-people-sync.md`
> **Date:** 2026-07-16
> **Verdict:** APPROVED

## Scope reviewed

Persisted 60-day Notion sync of tasks + the Notion people directory into the app database (Postgres in prod, SQLite in dev), linking each task to its person(s) via `tasks.assigneeId` + `task_people`.

## Changes

| Area | File | Notes |
|---|---|---|
| Schema (SQLite) | `packages/database/src/schema.ts` | `people.notionPageId` (+ index); `tasks.source` / `notionPageId` / `notionAccount` / `notionDb` (+ index); `TASK_SOURCES` |
| Schema (Postgres) | `packages/database/src/schema.pg.ts` | Mirror of the above |
| Runtime migration | `packages/database/src/index.ts` | Guarded `TASKS_COLUMNS` + new `people` ALTERs applied in `getDb()`; exported `TASK_SOURCES` / `TaskSource` |
| Sync service | `packages/api/src/services/notion-tasks-sync.ts` | Self-contained Notion client (60-day timestamp filter), people upsert/dedupe, task upsert by `notionPageId`, assignee + `task_people` linking, in-window prune |
| tRPC | `packages/api/src/routers/tasks.ts` | `tasks.notionConfigured` query + `tasks.syncFromNotion` mutation (auth) |
| Cron | `apps/web/src/app/api/cron/notion-sync/route.ts` | GET/POST, optional `CRON_SECRET`; calls `tasks.syncFromNotion` |
| Cron schedule | `deploy/crontab.example` | Every 30 min |
| UI | `apps/web/src/app/tasks/page.tsx` | "סנכרן מ-Notion" button (shown only when configured) + result banner |
| Tests | `packages/api/src/services/notion-tasks-sync.test.ts` | 7 cases |

## Spec conformance

- [x] Schema columns added to both `schema.ts` and `schema.pg.ts` + SQLite bootstrap.
- [x] Self-contained sync service using a 60-day window (created/last-edited timestamp filter).
- [x] Directory people upserted with `source='notion'` + `notionPageId`; dedupe `notionPageId` → email → name.
- [x] User person ensured to exist.
- [x] Task kept when user is assignee OR a directory person matches; done tasks skipped.
- [x] Upsert by `notionPageId`; `assigneeId` = user if assigned else first matched; all matched linked via `task_people`.
- [x] Idempotent (verified by test).
- [x] In-window prune of notion tasks no longer kept; `source='manual'` untouched.
- [x] `syncFromNotion` + `notionConfigured` auth-protected.
- [x] Cron route + crontab entry.
- [x] `/tasks` manual trigger with summary, gated on `notionConfigured`.
- [x] Vitest coverage.

## Verification

- `pnpm test` — 19 files, **153 passed** (incl. 7 new).
- `pnpm --filter @ak-system/web build` — success; `/api/cron/notion-sync` and `/tasks` compiled.
- `db:push` (SQLite) — clean additive apply, non-interactive.
- `ReadLints` — no errors on changed files.

## Notes / deviations

- Plan's `notion-read` step (extending `apps/web/src/lib/notion.ts`) was implemented **inside** the packages/api service instead: `packages/api` cannot import `apps/web/src/lib`, and the established Notion→DB ingestion pattern (`notion-ibkr-import.ts`) is a self-contained service called from tRPC with `ctx.db`. The runtime agent path (`getNotionTasks()`) is intentionally left unchanged.
- 60-day window uses Notion `created_time` / `last_edited_time` timestamp filters (robust across databases with differing date-property names). Task due dates are still parsed and stored.
- Prune is bounded to pages fetched in-window (completed/unassigned), so older unedited tasks are never deleted.
- `next lint` in `apps/web` is interactive (ESLint not configured in the repo) — pre-existing, unrelated to this change. Type-checking is covered by the successful Next build; other packages pass `tsc --noEmit`.

## Follow-ups (non-blocking)

- Consider surfacing last-sync time/errors in Settings › NotionCard.
- Primary-assignee ordering when multiple non-user directory people are assigned currently picks the first match.
