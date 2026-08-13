# Review — feed-ai-tldr-digest

**Detected stack:** next-trpc-monorepo
**Verdict:** APPROVED
**Date:** 2026-08-13

## Spec conformance

- [x] Button **תמצית הפיד** / loading **קורא את כל העדכונים...** — `apps/web/src/app/updates/page.tsx`
- [x] Latest items in current category (limit 100) sent to Gemini — `packages/api/src/routers/feed.ts` `generateDigest`
- [x] Card above the list: TLDR + שים לב with links — `updates/page.tsx` `data-testid="feed-digest"`
- [x] Persisted per category — `feed_digests` in SQLite + Postgres schemas
- [x] Empty feed / missing Gemini Hebrew errors
- [x] UI no longer calls `generateSummaries`
- [x] Vitest + Playwright as specified

## UI/UX Review

**Verdict:** APPROVED

### Checklist
- [x] `.btn` / `.card` utilities
- [x] Dark theme / teal accent
- [x] RTL
- [x] Loading / empty / error states
- [x] No new CSS frameworks
- [x] Digest card is the answer to “where do I see this?”

## Static checks

| Check | Result |
|---|---|
| `pnpm test` | PASS — 675 + 172 |
| `e2e/updates.spec.ts` | PASS — 2/2 |
| `pnpm --filter @ak-system/web build` | PASS |
| `pnpm -r run lint` | SKIP — pre-existing `next lint` prompt |

## Findings

### Must-fix / Should-fix / Nits

None for this change. `generateSummaries` remains in the router unused by the UI (spec).

## Suggested PR description

Replace per-item feed tagging with a Hebrew TLDR + watch-list briefing of the current updates feed, shown in a card at the top of `/updates`.
