# Review — harness-project-topic-nodes

**Spec:** `docs/specs/harness-project-topic-nodes.md`
**Verdict:** APPROVED WITH NITS
**Date:** 2026-11-16

## What changed

- New `projects` and `topics` harness scopes:
  - project nodes with `BELONGS_TO` and `MEMBER_OF` edges;
  - topic nodes for tokens seen in at least 2 sources (meeting titles, analysis topics, open tasks, WhatsApp group names, memory topics). Project-name tokens are excluded.
- New tools `get_project_context` and `get_topic_context` (`services/harness-entity-context.ts`), gated to the CoS agents, plus a CoS prompt line.
- The 6-hourly harness cron refreshes up to 3 stale project briefs, and one failure does not stop the others.
- `HarnessWidget` links project insights to `/projects/<id>`.

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

- Project node attrs leave out `warmth`, because it costs one heavy query per project. `get_project_context` returns warmth.
- `ABOUT` edges run from meeting nodes only, because tasks and WhatsApp groups are not harness nodes. Their ids and names are kept in the topic node's attrs, and `get_topic_context` reads them live.

## Nits / follow-ups

1. Is the topic threshold (2 sources) right? This needs real data to judge.
