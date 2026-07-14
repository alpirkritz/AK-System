# Reviewer Report — WhatsApp Group Insights

Stack: `next-trpc-monorepo`
Spec: `docs/specs/whatsapp-group-insights.md`
Verdict: **APPROVED WITH NITS**

## Scope implemented

Persistent 30-day archive of watched-group WhatsApp messages plus on-demand insights: per-group summary/topics/style, and a prioritized cross-group "what's happening now" briefing that ranks by importance and links context across groups. Surfaced via tRPC, Hugo tools, and a new Insights tab.

## Files changed

Database
- `packages/database/src/schema.ts` — new `whatsapp_messages` table (+ `(group_jid, ts)` index, `(group_jid, wa_message_id)` unique index); `whatsapp_groups.priority`.
- `packages/database/src/schema.pg.ts` — same for Postgres.
- `packages/database/src/index.ts` — raw DDL for the table/indexes, `WHATSAPP_GROUPS_COLUMNS` ALTER for `priority`, exports/types, added `gte/lte/gt/inArray` re-exports.

Ingestion / retention
- `apps/whatsapp-bridge/src/group-buffer.ts` — independent persist queue (`enqueuePersistMessage`, `drainPersistQueues`, `requeuePersistMessages`).
- `apps/whatsapp-bridge/src/whatsapp-client.ts` — enqueue on watched-group messages; `flushPersistQueues` + 60s `startPersistFlushLoop`; flush before summary clear.
- `apps/whatsapp-bridge/src/config.ts`, `apps/whatsapp-bridge/src/index.ts` — `AK_MESSAGES_INGEST_URL` + start loop.
- `apps/web/src/app/api/whatsapp/messages/ingest/route.ts` — batch ingest (enabled-only, ms normalization, dedupe).
- `apps/web/src/app/api/cron/whatsapp-message-retention/route.ts` — daily purge (`WHATSAPP_MESSAGE_RETENTION_DAYS`, default 30).
- `deploy/crontab.example`, `deploy/whatsapp-bridge.env.example` — cron entry + env doc.

API / AI
- `packages/api/src/services/whatsapp-insights.ts` — `generateGroupInsight` (summary/topics/style) + `generateCrossGroupDigest` (self-contained Gemini, mirrors `feed-summarizer.ts`).
- `packages/api/src/routers/whatsapp.ts` — `messages.listByGroup`, `messages.stats`, `insights.forGroup`, `insights.digest`; `priority` in `groups.upsert`; cascade delete of messages in `groups.delete`.

Hugo tools
- `apps/web/src/lib/conversation-engine.ts` — `whatsapp_now`, `query_whatsapp_group`, `whatsapp_group_insights` (declarations + executors, with fuzzy group-name resolution).

UI
- `apps/web/src/app/settings/whatsapp/page.tsx` — Insights tab (cross-group digest + per-group drill-in + stats), per-group priority selector.

Tests
- `packages/api/src/routers/whatsapp.test.ts` — 7 tests (priority round-trip, listByGroup window, stats, cascade delete, forGroup no-message path, digest empty/no-activity paths).
- `apps/web/e2e/whatsapp-insights.spec.ts` — Insights tab render + disabled-until-selected.

## Verification

- Unit tests: `vitest run` (packages/api) → **105 passed (14 files)**, including the 7 new WhatsApp tests. Run directly with `DATABASE_PATH` set to bypass the interactive `pretest` (see nit).
- Type check / build: `pnpm --filter @ak-system/web build` → **success**; new routes `/api/whatsapp/messages/ingest`, `/api/cron/whatsapp-message-retention` and updated `/settings/whatsapp` present.
- Bridge type check: `apps/whatsapp-bridge` `tsc --noEmit` → **pass**.
- Lint: `apps/whatsapp-bridge` + `apps/mobile` pass. `apps/web`'s `next lint` prompts to configure ESLint interactively (pre-existing: no ESLint config in `apps/web`) — not introduced by this change; build-time type checking is green.

## Nits / follow-ups

1. `drizzle-kit push` (the `pretest`/`pretest:e2e` hook) is interactive when the schema adds a table — it prompts "created or renamed?" and blocks CI. Runtime `getDb()` creates the table via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN`, so tests pass when run directly. Consider `drizzle-kit push --force` (or generate + migrate) in the pretest to keep CI non-interactive. Not fixed here to avoid changing shared tooling behavior.
2. Playwright `pnpm e2e` was not executed in this environment because its `pretest:e2e` hits the same interactive push and e2e needs a running server; the spec file is added and mirrors existing patterns.
3. Ingest dedupe pre-filters by existing `wa_message_id`; the unique index is the final guard. Under heavy concurrency a rare duplicate batch could still throw — insert is wrapped in try/catch and returns 500, and the bridge requeues, so no data loss.

## Compliance

Third-party message content is PII. Mitigations in place: enabled-groups-only persistence, 30-day retention cron, cascade delete on group removal, single-tenant self-hosted DB, no new external data flow (Gemini already used for summaries).
