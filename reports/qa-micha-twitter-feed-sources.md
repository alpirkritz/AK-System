# QA — micha-twitter-feed-sources

> **Slug:** `micha-twitter-feed-sources`
> **Date:** 2026-08-13
> **Detected stack:** next-trpc-monorepo

## Spec

`docs/specs/micha-twitter-feed-sources.md`

## Verdict

PASS — unit, targeted e2e, and web build are green. Full `pnpm e2e` was not re-run (only `e2e/updates.spec.ts`).

## Commands

| Check | Result |
|---|---|
| `pnpm test` | PASS — API 668, web 172 |
| `pnpm --filter @ak-system/web run test:e2e -- e2e/updates.spec.ts` | PASS — 2/2 |
| `pnpm -r run lint` | SKIP — `next lint` prompts to create an ESLint config (pre-existing) |
| `pnpm --filter @ak-system/web build` | PASS |

## Coverage

- Vitest: `packages/api/src/services/feed-fetcher.test.ts` — RSS URL builder, nitter→x.com rewrite, all 39 Micha handles, unique ids
- Vitest: `packages/api/src/routers/feed.test.ts` — `feed.sync` seeds defaults (mocked fetch), idempotent second sync
- Playwright: `/updates` heading + tabs; מקורות form labels and X-accounts helper copy

## Notes

- `TWITTER_RSS_BASE` is optional; not added to the production env validator (correct — default nitter.net).
- Live Nitter fetch of ~40 accounts was not exercised in CI (mocked in unit tests). First real sync may 404 on renamed/dead handles (`@ElonJet`, `@steveweisscnbc`, `@AnastasiaAmoroso`).
- Full Playwright suite not re-run; only the new updates spec.
