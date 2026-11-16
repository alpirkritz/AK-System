# Review — memory-distiller

**Spec:** `docs/specs/memory-distiller.md`
**Verdict:** APPROVED WITH NITS
**Date:** 2026-11-16

## What changed

- `memories.status` (`active` / `proposed` / `rejected` / `superseded` / `disabled`), `evidence` and `replaces_memory_id`. Only active memories are injected or recalled.
- The nightly `/api/cron/memory-distiller` (crontab `40 2 * * *`) reads done meeting analyses, WhatsApp DM summaries and the owner's own words to Hugo since its cursor.
- One Gemini call per 20 sources.
- Proposals are filtered at confidence ≥0.6 and capped at 15. Dedupe uses Jaccard ≥0.8 against active, proposed, rejected and superseded memories.
- Names are resolved to links.
- Accept, edit-accept (supersede copies links) and reject (kept for dedupe).
- UI: a "הצעות (N)" tab on `/memory` with evidence, the replaced memory struck through, and "דחה הכל".
- The morning brief notes pending proposals, and Hugo has the tool `review_memory_proposals`.

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

- No nav badge in `DashboardLayout`; the count shows in the tab and in the morning brief.
- Hugo's tool accepts proposals as-is and does not edit them. Edits happen on `/memory`.

## Nits / follow-ups

1. Distiller cost is one Gemini call per 20 sources per night. Worth watching in `agent_run_logs` / the Gemini budget.
