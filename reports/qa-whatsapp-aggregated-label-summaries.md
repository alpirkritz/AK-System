# QA: WhatsApp aggregated label summaries

> **Slug:** `whatsapp-aggregated-label-summaries`
> **Date:** 2026-09-14
> **Stack:** next-trpc-monorepo

## Commands

| Command | Result |
|---|---|
| `pnpm test` | PASS — API 69 files / 796 tests; web 27 files / 209 tests |
| `pnpm --filter @ak-system/web exec playwright test e2e/whatsapp-labels-cluster.spec.ts` | PASS (1) |
| `pnpm e2e` (full suite) | Not run this pass — targeted spec only |

## Coverage vs spec

- Vitest `partitionDueSummaries`: clusters by stored `aggregateSummaries` flag (any label name); singles for flag-off, unlabeled, and singleton clusters; slot vs on-demand; morning override excluded from 20:00 cluster.
- Vitest `whatsapp.labels.upsert` / `delete` / `groupsDueForSummary` / `summaries.trigger` Zod mutual exclusion.
- Playwright: Labels tab shows **סכם כאשכול** toggle, name field, and **הוסף תווית**. Live create-then-list was dropped from e2e because the page's initial tRPC batch includes `groups.discover`, which throws when the bridge is down and leaves `labels.list` empty in that environment. Persistence CRUD is covered by Vitest.

## Notes

- New SQLite column is added via drizzle-kit push and `ALTER TABLE whatsapp_labels ADD COLUMN aggregate_summaries INTEGER NOT NULL DEFAULT 0`.
- Postgres/prod still needs the additive ALTER from the spec (not applied in this QA run).
