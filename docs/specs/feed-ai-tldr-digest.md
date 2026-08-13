# Feed AI TLDR digest

> **Slug:** `feed-ai-tldr-digest`
> **Status:** Implemented
> **Last Updated:** 2026-08-13

## Goal

Repurpose **✨ צור סיכומים (AI)** on `/updates` so it reads the current feed (not 10 untagged headlines) and produces a Hebrew briefing: a short **TLDR** plus a **שים לב** list of items that need attention. The briefing is shown in a card at the top of the פיד tab so the user always knows where to look.

## User Stories

- As Alpir, I want one click to digest everything currently in the feed so I do not scan dozens of X/RSS cards.
- As Alpir, I want a persistent TLDR + watch list at the top of עדכונים so I still see it after refresh.
- As Alpir, I want the digest to follow the category tab I am on (הכל / כלכלה / בורסה ארה"ב / …).

## Acceptance Criteria

- [ ] The feed-tab button is labeled **תמצית הפיד**; while running it says **קורא את כל העדכונים...**
- [ ] Clicking it sends the latest items in the **current category** (up to 100, newest first) to Gemini in one request.
- [ ] Response is shown in a card **above** the item list: TLDR paragraph + **שים לב** bullets (title, why it matters, link to the original item when known).
- [ ] Last digest per category is persisted and loaded on page open (`feed.getDigest`).
- [ ] Empty feed: button disabled; card explains to sync first.
- [ ] Missing `GEMINI_API_KEY` or Gemini failure: Hebrew error next to the button; previous digest (if any) stays.
- [ ] Existing per-item `feed.generateSummaries` is no longer used by the UI.
- [ ] Vitest covers digest JSON parse (item-index → link) and `feed.generateDigest` / `feed.getDigest`.
- [ ] Playwright: digest card and renamed button are visible on `/updates`.

## Data Model

New table `feed_digests` in `packages/database/src/schema.ts` **and** `schema.pg.ts`, plus SQLite bootstrap in `packages/database/src/index.ts` (`FEED_TABLES`):

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | Category key: `all` \| `economics` \| `us_market` \| `ai_tech` \| `israel_market` |
| `tldr` | text not null | Hebrew overview |
| `watch` | text not null | JSON array of `{ title, why, link, sourceName }` |
| `item_count` | integer not null | How many items were sent to the model |
| `generated_at` | text not null | ISO timestamp |

No change to `feed_items` / `feed_sources`.

## tRPC API

`packages/api/src/routers/feed.ts` — all `protectedProcedure`:

- **`feed.getDigest`**
  - input: `{ category: z.enum(['all','economics','us_market','ai_tech','israel_market']).default('all') }`
  - return: `{ tldr, watch: { title, why, link, sourceName }[], itemCount, generatedAt, category } | null`
- **`feed.generateDigest`**
  - input: `{ category: same enum default 'all', limit: z.number().min(1).max(150).default(100) }`
  - loads items (same join as `feed.list`), calls Gemini once, upserts `feed_digests` for that category, returns the digest
  - `BAD_REQUEST` if no items; `PRECONDITION_FAILED` / Hebrew message if `GEMINI_API_KEY` missing

Logic in `packages/api/src/services/feed-digest.ts` (prompt + JSON parse). Reuse `GEMINI_MODEL` like `finance-narrative.ts`.

`feed.generateSummaries` stays in the router but is unused by the page.

## UI Surface

`apps/web/src/app/updates/page.tsx` (feed tab only):

- Header button: **תמצית הפיד** (ghost/teal, existing `.btn`).
- Card `.card` above the category chips / list (`data-testid="feed-digest"`):
  - Title **תמצית**; muted meta `על בסיס N עדכונים · <time>`
  - **TLDR** — 2–4 Hebrew sentences
  - **שים לב** — 3–7 rows; title links out (`target=_blank`); `why` as muted line
  - Empty: “לחץ על תמצית הפיד כדי לקבל סיכום ומה שכדאי לשים לב אליו.”
- Loading: card stays, button disabled + spinner label.
- Mobile: same stack; card full width.

## Out of Scope

- Per-item Gemini tagging (old button behavior).
- Push/Telegram of this digest (`feed_digest` notification type unchanged).
- Mobile app updates screen.
- Auto-refresh digest on cron sync.
- New feed categories.

## Open Questions

None — window is the current category’s latest 100 items (“all” of what is on the page, not full history).
