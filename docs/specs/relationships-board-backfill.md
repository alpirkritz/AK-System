# Relationships board — backfill and full picture

Follows `relationships-attention.md`. That spec built the page; this one makes it show something.

## Goal

`/relationships` on production is empty although hundreds of meetings with notes exist. Two causes, both fixed here:

1. **No analyses.** The board reads `meeting_analyses.score`, but almost no meeting has an analysis. The `transcript-analysis` cron only looks at meetings that ended in the last 30 minutes, and the Notion sync only triggers analysis for `notes_db` notes — every note in the DB is a `meeting_page_summary`, which never triggers anything. The dev copy of the DB shows the shape: 705 meetings, 500 notes with a body over 100 characters, 300 of them in the last 180 days with linked people, **0 analyses**.
2. **The board hides everything that is not a mover.** A person with 30 analysed meetings that are all in the last 90 days has no "older" window, so the trend is `null` and the card is dropped. Stable people are dropped too. The page then says "אין כרגע קשר שזז" with no hint about why.

After this change the page shows every relationship that has analysed data, says how much data there is and how much is still waiting, and lets Alpir push the backlog through from the page.

## User stories

- As Alpir, I want the page to tell me how many conversations are analysed and how many are waiting, so an empty page is an explanation rather than a mystery.
- As Alpir, I want a button that analyses the waiting conversations now, so I do not wait a day for the cron.
- As Alpir, I want the backlog to drain by itself, so the page fills over the next days without me pressing anything.
- As Alpir, I want to see every person I have analysed conversations with — cooling, warming, stable, or too early to say — with the score, the last meeting and the latest mood, so the page is a picture of my relationships and not only an alarm.
- As Alpir, I want a person with many meetings in one quarter to still get a trend, so a busy relationship is not invisible.

## Acceptance criteria

### Backlog

- Given a meeting dated within the last 180 days and not after today, with a `meeting_notes.body_text` of at least 100 characters (any `source_kind`), and no `meeting_analyses` row with status `completed` or `pending`, and no `failed` row younger than 1 hour, when the backlog is listed, then that meeting is in it. Meetings with at least one `meeting_people` link sort first, then newest first.
- Given the backlog, when `/api/cron/transcript-analysis` runs, then after its recent-meeting pass it analyses up to `ANALYSIS_BACKFILL_PER_RUN` (default 3) backlog meetings. Backlog analyses are stored with `source = 'backfill'`, get a `completed` row on success and a `failed` row with the error on failure, and send **no** WhatsApp or push message and propose **no** commitments. The response JSON gains `backfilled` and `backlogRemaining`.
- Given the page, when it loads, then a strip above the sections reads "{analysed} שיחות מנותחות · {people} אנשים · {pending} ממתינות לניתוח". When `pending > 0` it shows a button "נתח עכשיו" which analyses up to 5 backlog meetings and then refreshes the strip and the board. While in flight the button is disabled and reads "מנתח…". After it finishes the strip shows "נותחו {n}" (and "{f} נכשלו" when any failed) until the next click. When `pending = 0` the button is absent.
- Given no analysed meetings at all, when the page loads, then instead of the old empty sentence it reads "עוד אין שיחות מנותחות. {pending} שיחות עם סיכום מחכות לניתוח." with the same button. When there is nothing to analyse either: "אין שיחות עם סיכום בחצי השנה האחרונה. הקשרים נבנים מסיכומי הפגישות בנושן."

### Board

- Given a confirmed person with at least one analysed meeting in the last 180 days, when the board loads, then that person has a card. `trend` is `'warming' | 'cooling' | 'stable' | null`.
- Given at least 4 analysed meetings, when both the recent-90 and the previous-90 windows have at least one meeting, then trend uses those windows as before. When the previous window is empty, then the meetings are split into a newer half and an older half (`Math.ceil(n / 2)` newest against the rest) and the same 0.2 rule applies. Fewer than 4 meetings gives `null`.
- Given the cards, when the page renders, then people sections appear in this order: "מתקררים", "מתחממים", "יציבים", "עוד אין מגמה". Circles follow: "חוגים מתקררים", "חוגים מתחממים", "חוגים יציבים". Movers are ordered by absolute gap, largest first. Stable and no-trend cards are ordered by last meeting date, newest first. Empty sections are omitted.
- Given a card, when it renders, then it shows: name; a pill "מתקרר" (yellow) / "מתחמם" (green) / "יציב" (muted blue) / "{count}/4 שיחות" (muted) for no trend; the −1…+1 bar chart; "ציון ממוצע {avgScore}/10"; "פגישה אחרונה {d.m}"; the data sentence (for movers, as before; for stable "הציון סביב {avgScore}." ; for no-trend "אחרי 4 שיחות מנותחות תופיע מגמה."); the latest mood as "אווירה: {mood}" and the latest key insight trimmed to 140 characters when present; the three latest meetings; the note controls unchanged from the previous spec.
- Given a saved circle or any series with at least 2 analysed instances, when the board loads, then it has a card. Trend requires 6 instances as before; under 6 the pill reads "{count}/6 מפגשים". `rosterSavedAt` is no longer required, because no series in the DB has it set and the page would otherwise never show a circle.
- Given `relationshipFlags` (people-list pills, dashboard highlight), when it runs, then it is unchanged: movers only, with the same half-split fallback so the two views agree.

## Data model

No schema change. `meeting_analyses.source` gains the value `'backfill'` (free text column).

## tRPC API

`packages/api/src/routers/insights.ts`, all `protectedProcedure`:

- **`relationshipBoard`** (query) — return shape becomes `{ people: Card[], circles: Card[], summary: { analysedMeetings, peopleWithData, pendingBacklog } }`. `Card` gains `trend: 'warming' | 'cooling' | 'stable' | null`, `avgScore: number | null` (mean 1–10, one decimal), `lastDate: string | null`, `latestMood: string | null`, `latestInsight: string | null`, `minForTrend: number` (4 for people, 6 for circles).
- **`analysisBacklog`** (query) — `{ pending: number, analysed: number, sampleTitles: string[] }` over the 180-day window.
- **`runAnalysisBacklog`** (mutation) — input `{ limit: z.number().int().min(1).max(5).default(5) }`, returns `{ analysed: number, failed: number, remaining: number }`. Runs sequentially; no notifications.

Service: new `packages/api/src/services/analysis-backlog.ts` with `listAnalysisBacklog(db, { now, limit? })` and `runAnalysisBacklog(db, { limit, now, analyze? })`. `analyze` defaults to `analyzeTranscript` and is injectable for tests. Exported from `packages/api/src/index.ts` for the cron.

## UI surface

- `apps/web/src/app/relationships/page.tsx`: summary strip + button (`.card`, `.btn-primary`), new sections, new empty states. Skeleton loading unchanged.
- `apps/web/src/components/relationship/RelationshipCard.tsx`: broadened `BoardCard`, four pill states, score/last-date line, mood + insight lines. Note editing unchanged.
- `apps/web/src/app/api/cron/transcript-analysis/route.ts`: backlog pass after the recent pass.
- Mobile: no changes. `apps/mobile/app/(tabs)/relationships.tsx` filters by `trend === 'cooling' | 'warming'`, so extra cards are ignored there. Mobile parity for the full board is a follow-up.

## Tests

- `packages/api/src/services/analysis-backlog.test.ts`: lists only eligible meetings (body length, window, existing completed/pending, fresh failed vs old failed), people-first ordering, `runAnalysisBacklog` with an injected analyzer stores completed and failed rows and reports counts.
- `packages/api/src/routers/insights.person-context.test.ts` ("relationship board"): a person with 4 meetings all inside 90 days gets a trend via the half split; a stable person and a 2-meeting person appear with `stable` / `null`; summary counts are right.

## Out of scope

- Mobile rendering of stable / no-trend cards.
- Changing the 0.2 threshold or the 4 / 6 minimums.
- Re-analysing meetings that already have a completed analysis.
- Analysing meetings older than 180 days.
- Linking analysis participants to people automatically (existing confirm flow stays).

## Open questions

None blocking. Default backfill rate is 3 per 10-minute cron run (~430/day), well inside Gemini Flash free-tier limits; raise `ANALYSIS_BACKFILL_PER_RUN` on the box to drain faster.
