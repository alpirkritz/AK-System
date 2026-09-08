# QA — notion-summary-readable

> **Date:** 2026-09-08
> **Stack:** `next-trpc-monorepo`

## Scope

Readable Notion AI meeting summaries on meeting detail (and reused on person/project related notes). Parser + `NotionSummaryCard` only; no API/schema changes.

## Results

| Suite | Result |
|---|---|
| Vitest `apps/web/src/lib/notion-summary-format.test.ts` | 5 passed |
| Playwright `e2e/meeting-ai-notes.spec.ts` | 3 passed |

Full `pnpm test` / `pnpm e2e` not re-run for this UI-only change. Targeted coverage matches the spec.

## Notes

- Expand/collapse is covered by the new briefing e2e case.
- Existing excerpt case still asserts `סיכום AI (Notion)` and `מדף הפגישה ב-Notion`.
