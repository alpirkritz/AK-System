# Review — harness-world-state-header

**Spec:** `docs/specs/harness-world-state-header.md`
**Verdict:** APPROVED WITH NITS
**Date:** 2026-11-16

## What changed

- `services/harness-header.ts` renders "תמונת מצב (harness)": last index and reason times, a stale warning after 8 hours, and the top 5 insights with `basedOn`, within 1,500 chars. It is injected for Hugo, 03 and 04.
- `harness_insights.facts_hash` lets `reasonAndPersist({ phraseChangedOnly })` keep the stored wording for unchanged facts. A new hourly cron, `/api/cron/harness-reason` (crontab `25 * * * *`), uses it.
- Sync crons re-index their scope only when they changed rows: calendar → meetings + people, notion → meetings, email, WhatsApp groups, and the three commitment scans. The push logic moved to `lib/harness-push.ts`.
- `user_settings.harness_indexed_at` / `harness_reasoned_at` are surfaced in `harness.worldState`, and `HarnessWidget` shows "עודכן לפני…".

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

- The mandatory `קישורים בין תחומים:` rule now covers the header too. The deterministic retry that enforces it still looks only at tool results.

## Nits / follow-ups

1. The crontab change must be applied on EC2 by hand (`deploy/crontab.example`).
