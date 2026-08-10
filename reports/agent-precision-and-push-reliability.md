# Report: agent-precision-and-push-reliability

> **Date:** 2026-08-03
> **Spec:** `docs/specs/agent-precision-and-push-reliability.md` (Approved)
> **Verdict:** IMPLEMENTED — **PENDING LOCAL QA** (sandbox cannot run vitest/build: macOS-only native binaries). Run the Verification commands below before deploy.

## Changes

### Push reliability
- `packages/database/src/schema.pg.ts` + `schema.ts` + `src/index.ts` — new `push_delivery_log` table (pg canonical, sqlite mirror, bootstrap SQL, export).
- `packages/api/src/lib/expo-push.ts` — every ok ticket logged as `pending`; new `checkPendingExpoReceipts()` fetches Expo receipts ≥15 min after send, marks ok/error/expired, prunes `DeviceNotRegistered` tokens, and creates a system notification (max 1/24h) on `InvalidCredentials`/`MismatchSenderId`. Ticket-level errors now also logged.
- `apps/web/src/lib/expo-push.ts` — shim re-exports the new function.
- `apps/web/src/app/api/cron/task-reminder/route.ts` — receipt check piggybacked (runs every minute, before the daily-digest gates).
- `packages/api/src/routers/push.ts` — `push.deliveryLog` query (last 50, tokens masked).
- `apps/web/src/app/settings/notifications/page.tsx` — read-only "יומן מסירת פוש" section (hidden when empty).

### Agent precision
- `apps/web/src/lib/agent-memory.ts` — cap 4000 → 12000; refactored to pure `composeMemoryPromptBlock()`; truncation never cuts mid-line and appends an explicit Hebrew marker.
- `apps/web/src/lib/gemini-agent-engine.ts` — (1) universal no-tables/concise guard for whatsapp/telegram/cron on **all** agents; (2) user memory block moved to the **end** of the system instruction with an explicit PRECEDENCE statement (user instructions beat MANDATORY formatting blocks, never grounding rules); (3) temperature 0.3 on cron channel.
- `apps/web/src/lib/agent-trigger-runner.ts` — cron history 20 → 3 messages (format-contamination fix).
- `apps/web/src/lib/notion.ts` — `calendarReview` injection capped at 6000 chars.
- `packages/api/src/services/notification-preferences.ts` — `morning_briefing.suggestedAgentId`: `06_calendar_optimizer` → `03_morning_briefing`.
- `apps/web/src/app/api/cron/morning-briefing/route.ts` — unrouted template output labeled "(תבנית אוטומטית ללא סוכן…)".

### Non-code (done earlier same day, no spec required)
- Agent cards/workflows cleaned of offline-framework contradictions: `A_Agents/01,03,04,07` + `S_Skills/wf_morning_brief.md`, `wf_email_assistant.md`.
- `scripts/local-cron.mjs` (+ `serve.sh` hook, `SKIP_CRON=1` to skip), `scripts/push-doctor.mjs`.

## Tests added
- `packages/api/src/lib/expo-push.test.ts` — 7 new cases: pending logging, receipt ok/error, credential alert, dead-token prune via receipt, no-ticket expiry, not-ready stays pending.
- `apps/web/src/lib/agent-memory.test.ts` — 5 cases: empty, under-cap, line-boundary truncation + marker, memories appended, budget exhaustion.
- `packages/api/src/services/notification-preferences.test.ts` — catalog regression: morning briefing suggests `03_morning_briefing`.

## Verification (run on the Mac — MANDATORY before deploy)

```bash
pnpm db:push                       # creates push_delivery_log
pnpm test                          # packages/api vitest
pnpm --filter @ak-system/web test  # web unit tests (agent-memory)
pnpm -r run lint
pnpm --filter @ak-system/web build
```

## Known risks / notes
- `sendExpoPush` now writes a log row per ticket — negligible volume (a few rows/day).
- Receipt check adds one Expo API call per minute **only** when pending entries ≥15 min old exist; otherwise it's a single indexed SELECT.
- Postgres deployments need the new table applied manually (drizzle config targets sqlite only) — SQL in `packages/database/src/index.ts` `PUSH_DELIVERY_LOG_TABLE` maps 1:1.
