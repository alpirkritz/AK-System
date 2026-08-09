# Review — Dynamic Agent Management

**Spec:** `docs/specs/dynamic-agent-management.md`
**QA:** `reports/qa-dynamic-agent-management.md`
**Stack:** `next-trpc-monorepo`
**Date:** 2026-08-09
**Verdict:** APPROVED WITH NITS

## Static checks

- `pnpm test` — 43 files, 485 tests passed.
- `pnpm --filter @ak-system/web build` — compiled successfully; typecheck clean; `/api/cron/scheduled-agents` appears in the route manifest.
- `pnpm -r run lint` — `apps/mobile` and `apps/whatsapp-bridge` (`tsc --noEmit`) pass. `apps/web` fails pre-existing: the package ships no ESLint config, so `next lint` enters its interactive setup prompt. Not introduced here; web types are covered by the build.

## Spec conformance

| Spec item | Implementation | Status |
|---|---|---|
| `agent_schedules` in both schemas + bootstrap | `packages/database/src/schema.pg.ts`, `schema.ts`, `index.ts` | Matches |
| `user_settings.agent_schedules_migrated_at` via additive ALTER | `packages/database/src/index.ts` `USER_SETTINGS_COLUMNS` | Matches |
| `agent_triggers` deprecated, retained, unread | Only remaining read is the migration source in `agent-schedules.ts:393` | Matches |
| Five `agents.*` procedures | `packages/api/src/routers/agents.ts:33-112` | Matches |
| `SCHEDULABLE_AGENT_IDS` / `isAgentSchedulable` removed | `packages/api/src/agents-meta.ts` | Matches |
| Per-slot dedup via shared `markAgentRan` state | `agent-schedules.ts:212-248`, `312-320` | Matches |
| `scheduled-agents` cron + deprecation shim | `apps/web/src/app/api/cron/scheduled-agents/route.ts`, `agent-triggers/route.ts` | Matches |
| Config tab + `AgentConfigPanel` | `apps/web/src/app/agents/manage/page.tsx`, `components/AgentConfigPanel.tsx` | Matches (label nit below) |
| Repointed consumers | `AgentTriggersPanel.tsx`, `settings/notifications/page.tsx`, `routers/finance.ts:1024` | Matches |
| `crontab.example` calls new path | `deploy/crontab.example` | Matches |

## What reads well

**The dedup fix is state, not coordination.** Both trigger paths funnel through `markAgentRan` (`packages/api/src/services/agent-schedules.ts:212`), and `hasAgentRunInSlot` at line 312 gates on `lastRunStatus === 'ok'` — so a failed run does not suppress the other path's attempt, which is the behaviour you want. This is what actually closes the duplicate-morning-briefing complaint, and it holds even if a future third trigger path is added, as long as it stamps.

**Validation happens before persistence.** `setSchedule` (`packages/api/src/routers/agents.ts:49-62`) resolves the agent and computes the post-merge enabled/times pair, then rejects `enabled` with zero times *before* calling `setAgentSchedule`. An earlier arrangement wrote first and validated after, which could leave an enabled-but-empty row.

**The migration is defensive in the right places.** `migrateAgentSchedulesOnce` (line 378) treats an unreadable guard column as "already migrated" rather than throwing, and wraps the legacy copy and the event seeding in independent try/catch blocks. A cold Postgres deploy where the ALTER has not run yet degrades to "no migration" instead of breaking `agents.list`, which is the whole management screen.

**The shim runs rather than no-ops.** `apps/web/src/app/api/cron/agent-triggers/route.ts` forwards to the shared runner and tags the response `deprecated: true`. The spec allowed a bare `{ ok: true, deprecated: true }`; forwarding is strictly better, because an EC2 crontab that has not been reinstalled keeps working instead of silently stopping. Per-slot dedup makes double-wiring harmless.

**Extracting `scheduled-agents-runner.ts` was necessary, not stylistic.** Next.js will not register a `route.ts` that another `route.ts` imports, so the shared handler had to move out of the route files for `/api/cron/scheduled-agents` to exist at all. The build output confirms it now does.

## Findings

### 1. Server accepted times that could never fire — fixed during review

`agents.ts:15` validated with `/^\d{2}:\d{2}$/`, which accepts `99:99` and `24:00`. Those persist happily and then never match a cron slot, so the agent looks configured and silently never runs. `AgentConfigPanel.tsx:6` already used the strict `/^([01]\d|2[0-3]):[0-5]\d$/`, so the API was the weaker of the two gates and anything not going through the panel (mobile, scripts, direct tRPC) could write dead schedules. Server regex tightened to match the client, with a case in `agents.test.ts` covering `99:99`, `24:00`, `7:00`, `07:60` and `morning`.

### 2. Nit — tab label differs from spec

The spec names the tab `הגדרות`; the implementation uses `הגדרות והרצה` (`apps/web/src/app/agents/manage/page.tsx`). The longer label is more accurate, since the panel also holds `הרץ עכשיו`. Keeping the implementation; flagging so the spec is not treated as the source of truth on this string.

### 3. Nit — `setEventSubscription` takes a `db` it only half-uses

`agent-schedules.ts:255` accepts `db` and uses it for the ownership read, but the write delegates to `upsertNotificationPreference`, which calls `getDb()` itself (`notification-preferences.ts:365`). Harmless today because `getDb()` is the single memoized handle per process, and it matches how other services in the package behave, so tests pass. It would become a real bug the day anything passes a genuinely different handle. Not worth threading a `db` parameter through `notification-preferences.ts` in this change.

### 4. Note — `DEFAULT_SCHEDULE_TIMES` no longer lists meeting prep

`04_meeting_prep_herald` was dropped from the suggestions in `packages/api/src/agents-meta.ts`, per spec, because it is event-driven. The panel therefore offers no suggested times for that agent. That is intended: a clock time for meeting prep is what caused the duplicate-run confusion originally.

## Security

- All five procedures are `protectedProcedure`; `agents.run` additionally requires `ctx.runAgentTrigger` to be wired.
- `agentId` is checked against the discovered `A_Agents/` set in `requireAgent` before any write, so a caller cannot create schedule rows for arbitrary IDs.
- Agent IDs never reach the filesystem as a path in this change; `listAgentsWithDisplayNames` enumerates the directory rather than joining user input.
- `triggerMessage` is capped at 4000 characters. Cron endpoints keep their existing `CRON_SECRET` bearer check via the shared runner.

## Post-merge

The EC2 crontab needs reinstalling (`scripts/install-server-cron-remote.sh`) to move off the deprecated path. The shim keeps things running until then, and its `console.warn` makes a stale crontab visible in the logs. Once the reinstall is confirmed, `apps/web/src/app/api/cron/agent-triggers/route.ts` can be deleted.
