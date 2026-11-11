# Review — calendar-optimizer-exclude-free-events

> **Date:** 2026-09-29
> **Spec:** `docs/specs/calendar-optimizer-exclude-free-events.md`
> **Stack:** `next-trpc-monorepo`

## Verdict

**APPROVED WITH NITS**

## Spec conformance

- [x] Transparent (Free) events still appear in "Events today", tagged `(מסומן כפנוי)`
- [x] `meetingHours` reduce excludes transparent events (verified: 1h opaque + 2h transparent → reports 1.0h)
- [x] Instructions in the prompt text tell the agent to treat tagged events as awareness-only (DNS/focus-block tier)
- [x] Events with no `transparency` field still default to busy — no regression (covered by test)
- [x] `A_Agents/06_calendar_optimizer.md` and `S_Skills/wf_calendar_optimizer.md` both updated (categorization, double-bookings, overload threshold, change log)
- [x] Vitest covers the new tag + load-exclusion, and the no-regression default case

## Changed files

- `docs/specs/calendar-optimizer-exclude-free-events.md`
- `packages/api/src/services/agent-calendar-context.ts`
- `packages/api/src/services/agent-calendar-context.test.ts`
- `A_Agents/06_calendar_optimizer.md`
- `S_Skills/wf_calendar_optimizer.md`
- `reports/calendar-optimizer-exclude-free-events.md`

## QA

- `npx vitest run src/services/agent-calendar-context.test.ts` (packages/api): **7/7 passed**, including the 2 new cases.
- Manual `tsx` smoke run reproduced the exact expected prompt output (free event tagged, excluded from the 1.0h total).
- `grep` confirms `agent-calendar-context.ts` has exactly one production call site for `formatAgentCalendarContextForPrompt`/`eventLine` (no other test file exercises the real implementation — `gemini-agent-engine.calendar-brief.test.ts` mocks `getAgentCalendarContext`), so blast radius is contained to this file.

### Not run (environment limitation, not related to this change)

- Full `pnpm test` / `pnpm -r run lint` / `pnpm --filter @ak-system/web build`: this sandbox's copy of `node_modules` was installed on macOS (darwin-arm64) but the sandbox runs Linux/aarch64, so esbuild's native binary doesn't match by default (pre-existing, unrelated to this change). Vitest for the touched file was run successfully after pointing `ESBUILD_BINARY_PATH` at a matching linux-arm64 binary; the full monorepo suite was not re-attempted end-to-end because of this same platform mismatch plus the suite's long serial runtime (shared SQLite, `fileParallelism: false`). Recommend running `pnpm test && pnpm -r run lint && pnpm --filter @ak-system/web build` from the Mac before/at next deploy.
- `packages/api` has no `lint` script of its own; `pnpm -r run lint` only actually lints `apps/web`, which this change doesn't touch.

## Findings

None blocking.

### Nits

1. Full monorepo QA (`pnpm test && pnpm e2e`) should still be run from the Mac per the standard pipeline before this ships, since only the directly affected test file was executed here.
2. `calendar.ts`'s `fetchAllEvents` (UI / pre-meeting-notification path) still drops transparent events entirely rather than tagging them — intentionally left alone per spec's "out of scope," but worth knowing this fix only changes the agent-facing prompt, not the calendar UI.

## Security

No auth/secrets changes. No new external data flows.
