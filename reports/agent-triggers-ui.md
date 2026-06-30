# Review: Agent Triggers UI

> **Spec:** `docs/specs/agent-triggers-ui.md`
> **Date:** 2026-06-30
> **Verdict:** APPROVED

## Summary

Implements per-agent trigger configuration (daily schedule, manual run, last-run status) on `/agents`, backed by `agent_triggers` DB table, tRPC `agents.triggers` router, shared `runAgentTrigger` runner, and `/api/cron/agent-triggers` poller every 15 minutes.

## Spec Conformance

| Criterion | Status |
|-----------|--------|
| `agent_triggers` schema (SQLite + PG) | OK |
| tRPC list / upsert / run / dueAtTime | OK |
| Cron endpoint with dedup | OK |
| Agents UI panel | OK |
| Parallel to lightweight cron | OK |
| Vitest + Playwright | OK |

## Security

- All trigger mutations require auth (`protectedProcedure`).
- Cron endpoint requires `CRON_SECRET` when set.
- Scheduled runs limited to Gemini engine (Cursor SDK rejected in runner).

## Nits

- `pnpm -r run lint` for `apps/web` prompts interactive ESLint setup (pre-existing; not introduced by this change).
- Default schedule times are suggested in UI but triggers remain disabled until user enables them.

## Tests Run

- `pnpm --filter @ak-system/api test` — 25 passed (incl. 7 new agents tests)
- `pnpm --filter @ak-system/web build` — success
- `playwright test e2e/agents-triggers.spec.ts` — 1 passed
