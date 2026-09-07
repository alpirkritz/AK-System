# Mobile updates TLDR + task title wrap

> **Slug:** `mobile-updates-tldr-and-task-title-wrap`
> **Status:** Approved for implementation (user request)
> **Last Updated:** 2026-09-06

## Goal

Bring the web `/updates` briefing (category filter, manual RSS sync, persisted TLDR + שים לב digest) onto the existing Helm updates screen, and make the task-detail title field wrap so a long Hebrew subject is fully readable.

## User stories

- As Alpir on the phone, I want the same feed digest I use on the web (TLDR + watch list) so I do not scan dozens of headlines on a small screen.
- As Alpir, I want to sync RSS sources from the phone and see how many items were added, so I can refresh the briefing without opening the laptop.
- As Alpir, I want category chips that match the web (הכל / כלכלה / בורסה ארה"ב / טק ו-AI / בורסה ישראלית) so the digest and list follow the same filter.
- As Alpir, I want tapping a feed item or a שים לב row to open the original article.
- As Alpir, I want a long task subject to wrap on the task-detail sheet so I can read and edit the full title.

## Acceptance criteria

1. Given I open **עוד → עדכונים**, when the screen loads, then I see a digest card at the top of the feed (empty hint if none stored) and the five web category chips — not dynamically extracted English category ids.
2. Given the current category has items, when I tap **תמצית הפיד**, then the button shows **קורא את כל העדכונים…**, `feed.generateDigest` runs for that category, and the card shows TLDR + שים לב. The previous digest stays visible until the new one arrives.
3. Given a stored digest exists for the selected category, when I reopen the screen or switch chips, then `feed.getDigest` loads that category’s digest (same persistence as web).
4. Given the feed for the selected category is empty, when I look at **תמצית הפיד**, then the button is disabled and the card says to sync first.
5. Given I tap **סנכרן מקורות**, when the mutation finishes, then I see Hebrew confirmation `נוספו N פריטים (M מקורות חדשים)` (or a human error), the list reloads, and the digest for the current category is refetched (not auto-regenerated).
6. Given a feed item or שים לב row has a link, when I tap it, then the URL opens in the system browser. Items without a link are not tappable.
7. Given Gemini is missing or the digest call fails, when generate finishes, then I see a Hebrew error (problem + retry) and any previous digest remains on screen.
8. Given I open an existing task whose title is longer than one line, when the detail sheet appears, then the **כותרת** field wraps onto multiple lines and I can still edit it. The field is not a single-line horizontal scroll.
9. Given source management (add/delete RSS), when I use the mobile app, then I do **not** see a מקורות tab — that stays web-only per `mobile-web-parity.md`.

## Data model

No schema changes. Reuse `feed_items`, `feed_sources`, `feed_digests` in `packages/database/src/schema.ts` and `schema.pg.ts`.

## tRPC API

No new procedures. Mobile wrappers in `apps/mobile/lib/data.ts` call existing `protectedProcedure`s in `packages/api/src/routers/feed.ts`:

- `feed.list` — query. Input: `{ category?: 'economics'|'us_market'|'ai_tech'|'israel_market', limit: number (80) }`. Return rows include `id`, `title`, `link`, `summary`, `publishedAt`, `sourceName`, `category`.
- `feed.sync` — mutation. No input. Return `{ sourcesInserted, itemsInserted }`.
- `feed.getDigest` — query. Input: `{ category: 'all'|'economics'|'us_market'|'ai_tech'|'israel_market' }`. Return `{ tldr, watch[], itemCount, generatedAt, category } | null`.
- `feed.generateDigest` — mutation. Input: `{ category, limit: 100 }`. Same return as getDigest.

Map API `link` onto the mobile item’s open-URL field. Today `fetchFeedItems` types `url` but the router returns `link`, so taps are dead.

## UI surface

### Mobile updates — `apps/mobile/app/updates.tsx`

Phone-adapted, not a clone of the web two-column sources layout.

**Hierarchy (content first):**

1. Action row — two 44px buttons, RTL: primary **סנכרן מקורות**, secondary **תמצית הפיד**. Do not put both in `SectionHeader` (one-action slot). Drop the duplicate in-page **עדכונים** heading; the stack header already has it.
2. Inline status (success green / error coral). Success auto-clears after ~4s.
3. Category `FilterChips` — wrapping, same five labels as web. Persist last chip via `storage` key `ak.updates-category` (SecureStore-safe; no colon).
4. Digest card (`Card`):
   - Title **תמצית**; meta `על בסיס N עדכונים · <time>` when a digest exists.
   - Empty: **לחץ על תמצית הפיד כדי לקבל סיכום ומה שכדאי לשים לב אליו.**
   - Empty feed: **אין עדכונים לסכם. סנכרן מקורות קודם.**
   - Loading: **קורא את כל העדכונים ומסכם…**
   - **TLDR** body wraps fully (`flexWrap`, no `numberOfLines` on the briefing).
   - **שים לב** rows: title (tappable), `why`, `sourceName`.
5. Item list: title 2 lines, summary 3, Hebrew category pill, source name, date. Pull-to-refresh reloads list + stored digest only (does not call `feed.sync`).

**Microcopy (match web):**

| State | Copy |
|---|---|
| Sync idle | סנכרן מקורות |
| Sync pending | מסנכרן… |
| Digest idle | תמצית הפיד |
| Digest pending | קורא את כל העדכונים… |
| Empty list | אין פריטים בקטגוריה זו |
| Empty list hint | לחץ על סנכרן מקורות כדי למשוך עדכונים |
| Sync/network error | לא הצלחנו לסנכרן. בדוק את החיבור ונסה שוב. |

### Mobile task detail — `apps/mobile/app/task/[id].tsx`

The **כותרת** `TextInput` is currently single-line, so long Notion subjects clip. Change it to a growing multiline field:

- `multiline` + `scrollEnabled={false}` (parent `ScrollView` owns scroll).
- `textAlignVertical: 'top'`, RTL `textAlign="right"`.
- `minHeight` ~72px so two lines are visible; grow with content; no `numberOfLines` cap.
- Keep the label **כותרת** (one term app-wide; do not rename to נושא).

## Out of scope

- מקורות tab / add / delete RSS on mobile (web-only).
- Auto-generating a digest after sync.
- Push/Telegram of the digest.
- Web `/updates` changes.
- New tRPC procedures or schema.
- Task list row wrapping (already wraps; bug is the detail field).

## Open questions

None.
