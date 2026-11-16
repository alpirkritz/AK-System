# Review — agent-feedback-loop

**Spec:** `docs/specs/agent-feedback-loop.md`
**Verdict:** APPROVED WITH NITS
**Date:** 2026-11-16

## What changed

- `log_agent_feedback` still appends to `M_Memory/agents_daily_sync.md`. It now also stores an `agent_feedback` row with a Gemini-suggested rule (`packages/api/src/services/agent-feedback.ts`).
- Applying a rule creates an `instruction` memory linked to `agent:<id>`. `buildRelevantMemoryBlock` always adds the running agent as the first anchor, so the rule reaches only that agent, under "כללים לסוכן הזה" (cap 20).
- UI: `AgentRulesPanel` on `/agents/manage` lists pending corrections with editable rules (**החל** / **דחה**) and active rules with an on/off toggle.

## Checks (shared run for all six context specs)

| check | result |
|---|---|
| `packages/api` Vitest | 146 files, 1595 tests pass |
| `apps/web` Vitest | 53 files, 348 tests pass |
| New Playwright | `e2e/hugo-context-layers.spec.ts` (3) and `e2e/hugo-entity-memory.spec.ts` (1) pass; `agent-config.spec.ts` still passes |
| `pnpm -r run lint` | no new findings (pre-existing warnings only) |
| `pnpm --filter @ak-system/web build` | passes; the new cron routes `/api/cron/harness-reason` and `/api/cron/memory-distiller` are listed |
| Full `pnpm e2e` (run before these specs) | 115 passed, 42 failed, 2 skipped. None of the failures touch the changed surfaces. They are stale selectors (`.modal` placeholder `תפקיד`, heading `פגישות חוזרות`, Slack `ערוצים`), e2e seed SQL with outdated columns (`people.updated_at`), and a sub-pixel width assertion |

## Deviations from spec

- The router is the top-level `agentFeedback`, not `agents.feedback` as the spec said. This keeps `routers/agents.ts`, which has unrelated uncommitted work, untouched.
- The panel renders below `AgentConfigPanel` in `app/agents/manage/page.tsx`, not inside it, for the same reason.

## Nits / follow-ups

1. If scoped retrieval fails, the fallback path (newest 60 active memories) can include other agents' rules. That path only runs on an error.
