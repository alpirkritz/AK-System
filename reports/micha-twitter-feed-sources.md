# Review — micha-twitter-feed-sources

**Detected stack:** next-trpc-monorepo
**Verdict:** APPROVED WITH NITS
**Date:** 2026-08-13

## Spec conformance

- [x] `DEFAULT_FEED_SOURCES` keeps the four news outlets and adds 39 Micha X accounts — `packages/api/src/services/feed-fetcher.ts:94` / `:160`
- [x] `feed.sync` inserts missing default ids then fetches — `packages/api/src/routers/feed.ts:134`
- [x] `twitterRssUrl(handle)` defaults to nitter.net, overridable via `TWITTER_RSS_BASE` — `feed-fetcher.ts:27`
- [x] `canonicalizeFeedLink` rewrites nitter.net → x.com — `feed-fetcher.ts:38`
- [x] Sync fetches with concurrency 5 — `feed.ts:14` / `:162`
- [x] Failed RSS fetch skips that source — `feed.ts:165`
- [x] Updates → מקורות copy mentions X accounts + sync — `apps/web/src/app/updates/page.tsx:200`
- [x] Vitest covers URL builder, rewrite, handle list, and sync seed
- [x] Playwright covers `/updates` + מקורות form

## UI/UX Review

**Verdict:** APPROVED

### Design System Checklist
- [x] Existing `.btn` / `.input` / `.select` / `.card` / `.label`
- [x] RTL unchanged
- [x] No new UI frameworks
- [x] Labels now have `htmlFor` on the add-source form

### UX Quality Checklist
- [x] Helper copy tells the user to sync once to seed X accounts
- [x] No new categories — items land in existing כלכלה / בורסה ארה"ב / טק ו-AI
- [x] Empty/error/sync states unchanged

## Static checks

| Check | Result |
|---|---|
| `pnpm test` | PASS — API 668, web 172 |
| `e2e/updates.spec.ts` | PASS — 2/2 |
| `pnpm -r run lint` | SKIP — `next lint` interactive (pre-existing) |
| `pnpm --filter @ak-system/web build` | PASS |

## Findings

### Must-fix

None.

### Should-fix

None.

### Nits

- `packages/api/src/services/feed-fetcher.ts:148` — `@ElonJet` and `:155` `@steveweisscnbc` / `:121` `@AnastasiaAmoroso` were not live-verified (Nitter rate-limited). They will still appear in מקורות after sync even if RSS 404s; delete from the UI if empty.
- `packages/api/src/services/feed-fetcher.ts:73` — RSS URLs are baked at module load. Changing `TWITTER_RSS_BASE` later does not rewrite already-inserted `feed_sources.url` rows.
- `next lint` still has no committed ESLint config.

## Out-of-scope / process

No schema change. No X API. No new feed category. Optional env only.

## Suggested PR description

Seed Micha’s trading/research X accounts into the updates feed as RSS sources (via Nitter), rewrite post links to x.com, and fetch them in parallel on sync.
