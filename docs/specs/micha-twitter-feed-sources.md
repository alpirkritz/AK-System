# Micha X/Twitter Feed Sources

> **Slug:** `micha-twitter-feed-sources`
> **Status:** Implemented
> **Last Updated:** 2026-08-13

## Goal

Seed the updates feed (`/updates`) with the X/Twitter accounts Micha follows for technical analysis, macro news, ARK research, Tesla/crypto coverage, and CNBC sentiment — so they appear under מקורות and start filling the פיד after the next sync, without requiring the user to paste ~40 RSS URLs by hand.

## User Stories

- As Alpir, I want Micha’s trading/research X accounts in עדכונים → מקורות so I can follow the same information diet from the app.
- As Alpir, I want a single "סנכרן מקורות" to insert any missing default sources (including these) and pull their latest posts.
- As Alpir, I want post links to open on x.com (not a third-party frontend) when I click an item in the feed.

## Acceptance Criteria

- [ ] `DEFAULT_FEED_SOURCES` in `packages/api/src/services/feed-fetcher.ts` includes the existing four RSS outlets **plus** one source per Micha account listed below (stable `id`, display `name` with `@handle`, category, RSS `url`).
- [ ] `feed.sync` inserts any of those sources that are missing (existing ids are not duplicated) and then fetches items from all sources.
- [ ] X sources use a single helper `twitterRssUrl(handle)` defaulting to `https://nitter.net/{handle}/rss`, overridable via `TWITTER_RSS_BASE` (no trailing slash required).
- [ ] `fetchRssFeed` rewrites `nitter.net` item links to `https://x.com/...` before insert.
- [ ] Sync fetches sources with bounded concurrency (not one-by-one) so ~40 X feeds do not take many minutes.
- [ ] A source whose RSS fetch fails is skipped (logged); other sources still sync.
- [ ] Updates → מקורות helper copy mentions that X accounts are pulled as RSS and appear after sync.
- [ ] Vitest covers: RSS URL builder, nitter→x.com rewrite, and that every expected Micha handle is present in `DEFAULT_FEED_SOURCES`.
- [ ] Playwright covers: `/updates` loads, מקורות tab is reachable, and the add-source form is visible.

## Data Model

No schema change. Existing `feed_sources` / `feed_items` in `packages/database/src/schema.ts` and `schema.pg.ts`:

- `feed_sources`: `id`, `name`, `url`, `category` (`economics` | `us_market` | `ai_tech` | `israel_market`), `created_at`
- `feed_items`: unique `link`; `source_id` ON DELETE CASCADE

X sources are rows in `feed_sources` with RSS URLs. No new columns.

## tRPC API

No new procedures. Existing `packages/api/src/routers/feed.ts`:

- `feed.sync` (protected mutation) — already seeds `DEFAULT_FEED_SOURCES` then fetches; extend fetch to run with concurrency ≤ 5.
- `feed.listSources` / `feed.createSource` / `feed.deleteSource` unchanged.
- Auth: all feed procedures remain `protectedProcedure`.

## UI Surface

- Route: `apps/web/src/app/updates/page.tsx`
- Feed tab: unchanged filters (`כלכלה`, `בורסה ארה"ב`, `טק ו-AI`, `בורסה ישראלית`).
- Sources tab: existing table + add form. Copy update only — explain that X accounts are seeded on sync as RSS sources.
- Mobile: no dedicated feed CRUD (out of existing mobile parity exceptions); web `/updates` is the surface.
- After deploy/local: user clicks **סנכרן מקורות** once to insert the new rows.

## Source list (Micha)

Handles below are the current public accounts (some renamed since the video). Display names keep the person/brand the user asked for.

### ניתוח טכני — `us_market`

| Name | Handle |
|---|---|
| Tamir T. | `@TamirTiko2110` |
| AJ Monte | `@theoptionoracle` |
| Katie Stockton | `@StocktonKatie` |
| Chris Verrone | `@verrone_chris` |
| Carter Braxton Worth | `@CarterBWorth` |
| Jake Wujastyk / TrendSpider | `@TrendSpider` |
| PuppyTrades | `@puppy_trades` |
| Danny Naz | `@ThePupOfWallSt` |

### מאקרו וחדשות — `economics` (trading desks → `us_market`)

| Name | Handle | Category |
|---|---|---|
| FSInsight | `@FSinsight` | us_market |
| Tom Lee | `@fundstrat` | us_market |
| Market Rebellion | `@MarketRebels` | us_market |
| The Fly | `@theflynews` | economics |
| Walter Bloomberg | `@DeItaone` | economics |
| Liz Young Thomas (SoFi) | `@LizThomasStrat` | economics |
| Anastasia Amoroso | `@AnastasiaAmoroso` | economics |
| Glassnode | `@glassnode` | us_market |

### ARK Invest — `ai_tech`

| Name | Handle |
|---|---|
| Cathie Wood | `@CathieDWood` |
| Sam Korus | `@skorusARK` |
| Ali Urman | `@urman_ali` |
| Tasha Keeney | `@TashaARK` |
| Will Summerlin | `@will_summerlin` |
| Yassine Elmandjra | `@yassine_elman` |

### טסלה / קריפטו — `us_market`

| Name | Handle |
|---|---|
| James Stephenson | `@ICannot_Enough` |
| Rob Maurer (Tesla Daily) | `@robmaurer` |
| Gary Black | `@garyblack00` |
| CryptosRus | `@CryptosRUs` |
| Michael Saylor | `@saylor` |
| Vijay Boyapati | `@real_vijay` |
| Tradytics | `@Tradytics` |
| Elon Musk's Jet | `@ElonJet` |

### CNBC — `us_market`

| Name | Handle |
|---|---|
| Kelly Evans | `@KellyCNBC` |
| Dominic Chu | `@TheDomino` |
| Sara Eisen | `@SaraEisen` |
| Jim Cramer | `@jimcramer` |
| Guy Adami | `@GuyAdami` |
| Jon Najarian | `@jonnajarian` |
| Pete Najarian | `@PeteNajarian` |
| Steve Weiss | `@steveweisscnbc` |
| Dan Nathan | `@RiskReversal` |

## Out of Scope

- Official X API / paid RSS.app subscriptions.
- New feed categories (e.g. "טריידינג") or grouping UI by Micha’s five buckets.
- Auto-healing dead/renamed handles after insert.
- Mobile feed-source CRUD.
- Changing Gemini summarization.

## Open Questions

- X has no native RSS. Public Nitter (`nitter.net/{handle}/rss`) worked at spec time but can rate-limit or drop RSS. `TWITTER_RSS_BASE` lets us point at another instance or a self-hosted bridge later.
- A few handles from the video are renamed or possibly inactive (`@LizYoungStrat` → `@LizThomasStrat`, `@TeslaPodcast` → `@robmaurer`, `@cCannot_Enough` → `@ICannot_Enough`, `@ElonJet` historically suspended). If a row never yields items, delete it from מקורות.
- Anastasia Amoroso’s handle in the video (`@AAmoroso_`) currently resolves to a different person; seeded as `@AnastasiaAmoroso`. Confirm in מקורות after first sync.
