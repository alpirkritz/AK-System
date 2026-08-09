# QA — Dynamic Agent Management

**Spec:** `docs/specs/dynamic-agent-management.md`
**Stack:** `next-trpc-monorepo`
**Date:** 2026-08-09
**Verdict:** PASS (8 pre-existing e2e failures outside this change, detailed below)

## Commands run

| Command | Result |
|---|---|
| `pnpm test` | 43 files, 484 tests passed |
| `pnpm --filter @ak-system/web build` | Compiled successfully; `/api/cron/scheduled-agents` registered |
| `pnpm e2e` (full) | 54 passed, 1 skipped, 8 failed — all 8 pre-existing |
| `pnpm e2e` (agent + notification specs) | 11 passed |
| `pnpm -r run lint` | mobile + whatsapp-bridge pass; `apps/web` fails pre-existing (no ESLint config) |

## Unit coverage added

`packages/api/src/services/agent-schedules.test.ts`

- Legacy `agent_triggers` rows carry over to `agent_schedules` exactly once; a second call is a no-op via the `user_settings.agent_schedules_migrated_at` guard.
- Migration seeds `pre_meeting_briefing → 04_meeting_prep_herald` so meeting prep works with no user setup, and does not overwrite an existing routing.
- `markAgentRan` stamps a run even when the agent has no schedule row yet (the event path needs this).
- `setAgentSchedule` preserves `lastRunAt` / `lastRunStatus` across edits.
- `wasAgentRunInSlot` matches only the same calendar day *and* the same `HH:MM` slot.
- `hasAgentRunInSlot` returns true only for a successful run, so one trigger path stands down for the other.
- `listAgentsDueAtTime` returns only enabled agents whose schedule contains the slot.

`packages/api/src/routers/agents.test.ts` (rewritten for the new surface)

- `agents.list` returns every card in `A_Agents/`, including a temporary `.md` created during the test then deleted — this is the dynamic-discovery criterion, and it passes with no code change.
- Any agent can be scheduled: the removed `SCHEDULABLE_AGENT_IDS` allowlist no longer gates `setSchedule`.
- `setSchedule` rejects a bad `HH:MM`, rejects `enabled: true` with no times, and rejects an unknown `agentId` with `NOT_FOUND` — all validated *before* anything is persisted.
- `setEventSubscription` takes an event over from its current owner, and unsubscribing clears `notification_preferences.agent_id` only when the caller owns it.
- `agents.dueAtTime` reflects what the cron would pick up.

## e2e coverage added

`apps/web/e2e/agent-config.spec.ts`

- Adds a schedule time, enables the clock trigger, saves, reloads, and asserts the configuration persisted.
- Removing the last time entry disables the toggle rather than leaving an enabled agent with nothing to run.
- Tab switching between `הגדרות והרצה`, the agent card, and the workflow keeps state.

`apps/web/e2e/agents-triggers.spec.ts` was repointed at the new API and at the actual `/agents` heading (`עוזר`), and now selects an agent from the `מצב` picker before asserting on the panel, which only renders for a specific agent.

## Acceptance criteria

| Criterion | Covered by | Status |
|---|---|---|
| New `A_Agents/*.md` appears and is configurable | `agents.test.ts` temp-agent case + `agent-config.spec.ts` | PASS |
| Enabled agent at `07:00` runs once, second call in slot skips | `agent-schedules.test.ts` slot cases + `dueAtTime` | PASS |
| `pre_meeting_briefing` routed to meeting prep runs 15 min ahead | seeding test + `pre-meeting-briefing` route using `runEventAgentIfRouted` | PASS |
| Scheduled *and* event-subscribed agent runs once per slot | `hasAgentRunInSlot` test; both paths stamp through `markAgentRan` | PASS |
| `agent_triggers` rows migrate once | migration tests | PASS |
| Clearing a checkbox nulls `agent_id` and falls back to the template | `setEventSubscription` test | PASS |
| All configuration through the UI | `agent-config.spec.ts` | PASS |

## Pre-existing failures (not caused by this change)

All 8 reproduce when their spec files run in isolation, so this is not suite interference, and all sit in dashboard/finance surfaces this change does not touch.

- `bank-accounts.spec.ts` — expects a `חיובי אשראי` label that the working tree's `AccountsTab.tsx` edits no longer render.
- `full-flow.spec.ts` (2) and `qa-structured.spec.ts` (4) — dashboard headings/greeting the tests still expect from an earlier layout.
- `trading-journal.spec.ts` — `getByText('P&L ממומש')` resolves to two nodes because committed `finance/page.tsx:283` renders a second one, tripping Playwright strict mode.

`apps/web` lint fails because the package has no ESLint config, so `next lint` drops into its interactive setup prompt and exits non-zero in CI. Web typechecking is covered by the production build, which passes.
