# Review — agent-episodes

**Spec:** `docs/specs/agent-episodes.md`
**Verdict:** APPROVED WITH NITS
**Date:** 2026-11-16

## What changed

- `agent_episodes` table. Every successful `runGeminiAgentChat` reply is recorded as a deterministic ≤400-char summary plus its anchors.
- Hugo, 03 and 04 get "מה כבר נאמר לך (24 שעות)": up to 6 episodes, those overlapping the run's entities first, within 1,500 chars, with a do-not-repeat rule.
- Episodes are pruned after 14 days in the daily retention cron.
- `harness.markActed` and the "טיפלתי" button; `insightKindStats` + `applyDowngrades` downgrade a kind dismissed ≥75% of ≥6 resolved insights over 30 days. The widget shows "הוחלש".
- `episodes.list`, and an "היסטוריה — 24 שעות" panel on `/agents/manage`.

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

- `insight_ids` is stored empty, because the engine's harness tool output drops insight ids. Downgrade stats therefore count every insight resolved in 30 days, not only ones surfaced in an episode.
- History is a panel under the agent rules, not a separate tab.
- Template-mode pushes, which run without an agent, are not recorded as episodes.

## Nits / follow-ups

1. The episode line shows the agent id, not its display name.
