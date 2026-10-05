# Code Review: Finance narrative cache

> **Slug:** `finance-narrative-cache`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-10-04

## Spec Conformance

Opening תזרים ותובנות reads the latest stored narrative and does not call Gemini. `force: true` is the only generation path, used by the refresh button and the daily cron. A changed fact-hash returns the previous text with `stale: true`. Missing `GEMINI_API_KEY` still serves a saved reading and rejects only a forced refresh.

No schema change. Cron is `30 2 * * *` in `deploy/crontab.example`, mirrored as a daily job in `scripts/local-cron.mjs`, and listed in `docs/deploy/cron-setup.md`.

## Static Checks

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/api exec vitest run src/routers/finance.insights-engine.test.ts` | PASS — 15 tests |
| `next lint` on InsightsTab, NarrativePanel, finance-narrative route | PASS |
| `pnpm -r run lint` | Not run. The worktree `tsc` already fails on unrelated files. |
| `pnpm --filter @ak-system/web build` | Not run. Playwright's Next server logged a pre-existing missing export `financePensionPolicies` from `@ak-system/database`. |
| Playwright `e2e/finance-insights.spec.ts` | 1 passed, 2 skipped, 1 failed. The failure is the accounts-tab URL assertion, outside this change. The narrative case skips when the e2e ledger has no categorized transactions, so the new button was not exercised in the browser. |

## UI Review

**Verdict:** APPROVED

### Checklist
- [x] Uses `.btn` / `.card` utilities
- [x] Dark theme colors match the existing narrative card (`#a78bfa` accent, muted `#97a4c2`)
- [x] RTL layout preserved (Hebrew copy, `border-inline-start`)
- [x] Mobile insights segment has a 44px press target and does not call Gemini on pull-to-refresh
- [x] Loading, empty, stale, and refresh-error states handled
- [x] No new CSS frameworks
- [x] Reuses `NarrativePanel`

### Findings
- Must-fix: none
- Nits: the web empty state replaces «אין עדיין ניתוח שמור» with the error line when the first generation fails. The button stays.

## Findings

### Must-fix

None.

### Should-fix

None.

### Nits

- `buildNarrativeRequest` takes `{ db: any }`, matching the other loaders in `packages/api/src/routers/finance.ts`.
- The daily cron loads facts twice when a refresh is needed: once to see `stale`, then again with `force`. That is once a day.

## Out of Scope Creep

None. Trading and overview are not on the daily cron.

## Suggested PR Description

Show the last cash-flow narrative immediately, and call Gemini only from the refresh button or the daily job after bank sync.
