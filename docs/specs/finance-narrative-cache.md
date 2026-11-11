# Finance narrative — show the last answer, refresh on demand, warm once a day

> **Slug:** `finance-narrative-cache`
> **Status:** Approved
> **Last Updated:** 2026-10-04

## Goal

Opening **תזרים ותובנות** currently calls Gemini whenever the stored narrative's fact-hash does not match today's numbers, so the paragraph blocks the tab for a long time on almost every visit. The tab should show the last saved narrative immediately, offer one button to generate a new one, and a daily cron should refresh the current month's cash-flow narrative after the bank sync so the answer is already waiting.

## User Stories

- As Alpir, I want the last cash-flow narrative to appear as soon as I open תזרים ותובנות, so that I am not waiting on Gemini just to read what I already saw.
- As Alpir, I want a button that asks Gemini for a new reading, so that I refresh only when I choose to.
- As Alpir, I want that reading prepared once a day, so that the paragraph is usually current even if I never press the button.
- As Alpir, I want the same behavior on the mobile insights segment, so that opening it does not wait on Gemini either.

## Acceptance Criteria

- [ ] Given a saved narrative for `cashflow:YYYY-MM`, when `finance.analytics.narrative` is called without `force`, then it returns that narrative and does not call `generateFinanceNarrative`, even if transactions have changed since it was written.
- [ ] Given no saved narrative for that scope, when the same query runs, then it returns an empty result (`available: false`) and does not call Gemini.
- [ ] Given `force: true`, when the query runs and `GEMINI_API_KEY` is set, then Gemini runs once, the new text is stored, and the response has `cached: false` and `stale: false`.
- [ ] Given a saved narrative whose `inputHash` differs from the current facts, when it is returned, then `stale: true`. Given an exact hash match, then `stale: false`.
- [ ] Given a saved narrative and no `GEMINI_API_KEY`, when the query runs without `force`, then the saved text is still returned. `force: true` without a key still fails with the existing precondition error.
- [ ] Given Gemini throws, when `force: true`, then nothing new is stored and the error surfaces (existing failure test).
- [ ] Given the user opens `/finance?tab=insights` with categorized transactions, when the narrative query resolves, then the panel shows the saved headline and body without a Gemini wait. The charts and KPIs still load on their own queries.
- [ ] Given a saved narrative, the panel shows when it was written and a button labeled `עדכן ניתוח`. While that request is in flight the button reads `מעדכן…` and is disabled.
- [ ] Given `stale: true`, a one-line note says the numbers changed since this reading (`הנתונים השתנו מאז הניתוח`).
- [ ] Given no saved narrative, the panel shows `אין עדיין ניתוח שמור` and a button `צור ניתוח`. It does not auto-fire Gemini and does not look like a load error.
- [ ] Given the mobile insights segment, opening it uses the non-force query. Pull-to-refresh does not call Gemini. A button on the narrative card calls `force: true`.
- [ ] Given `POST /api/cron/finance-narrative` with a valid `CRON_SECRET` (when set), when the current month's facts hash already matches the latest row, then Gemini is not called and the response is `{ ok: true, skipped: 'fresh' }`. When the hash differs or no row exists, Gemini runs once for `scope: 'cashflow'` and the current month, and the response is `{ ok: true, generated: true }`.
- [ ] The cron is scheduled once a day at 02:30 UTC in `deploy/crontab.example` (after bank sync at 01:45 UTC) and mirrored in `scripts/local-cron.mjs` as a daily job. It is not fired on local-cron boot.
- [ ] Vitest in `packages/api/src/routers/finance.insights-engine.test.ts` covers: read does not generate, stale read after a new transaction, force generates, empty cache, missing key on read vs force, generation failure is not stored. Playwright in `apps/web/e2e/finance-insights.spec.ts` expects the idle button (`צור ניתוח` or `עדכן ניתוח`) instead of treating a missing Gemini call as `נסה שוב`.

## Data Model

No new table and no new columns.

`finance_insight_narratives` stays as defined in both `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`:

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | unchanged |
| `scope_key` | text NOT NULL | unchanged, e.g. `cashflow:2026-10` |
| `input_hash` | text NOT NULL | unchanged |
| `model` | text | unchanged |
| `content` | text NOT NULL | JSON `{ headline, body, connections, watchlist }` |
| `generated_at` | text NOT NULL | unchanged |
| `created_at` | text NOT NULL | unchanged |

Unique index `uq_finance_insight_narratives_scope_hash` on `(scope_key, input_hash)` stays.

Read path: latest row for the scope key, `ORDER BY generated_at DESC LIMIT 1`, ignoring hash.

Write path (`force` or cron): insert the new hash. On conflict of the same `(scope_key, input_hash)`, update `content`, `model`, and `generated_at`. After a successful write, delete older rows for that same `scope_key` so only the latest reading is kept. Trading and cash-flow keys remain independent.

## tRPC API

Extend the existing `protectedProcedure` `finance.analytics.narrative` in `packages/api/src/routers/finance.ts`. Auth stays required.

Input (unchanged):

```ts
{
  scope: 'cashflow' | 'trading' | 'overview'
  month?: 'YYYY-MM'          // default current month
  period?: 'week' | 'month' | 'quarter' | 'all'  // default 'month', trading only
  force?: boolean            // default false
}
```

Return:

```ts
{
  available: boolean
  headline: string | null
  body: string | null
  connections: string[]
  watchlist: string[]
  generatedAt: string | null
  cached: boolean            // true when served from a stored row
  stale: boolean             // true when stored inputHash !== current facts hash
}
```

Behavior:

- `force` omitted or `false`: compute the current facts and hash (deterministic, no LLM), then return the latest stored row for that scope key. Never call `generateFinanceNarrative`.
- `force: true`: call `generateFinanceNarrative`, persist as above, return `available: true`, `cached: false`, `stale: false`.
- Empty store: `{ available: false, headline: null, body: null, connections: [], watchlist: [], generatedAt: null, cached: false, stale: false }`.

New cron route `apps/web/src/app/api/cron/finance-narrative/route.ts`, GET and POST, same `CRON_SECRET` bearer check as `apps/web/src/app/api/cron/morning-briefing/route.ts`. It uses `createServiceCaller()` and calls `finance.analytics.narrative({ scope: 'cashflow', force: true })` only when the latest row is missing or its hash differs. Hash comparison can live in a small exported helper next to the procedure (for example `cashflowNarrativeStatus`) so the cron does not need a second Gemini call to discover freshness. If `GEMINI_API_KEY` is unset, respond `{ ok: true, skipped: 'unconfigured' }`.

Mobile client: extend `fetchFinanceNarrative` in `apps/mobile/lib/data.ts` with an optional `{ force?: boolean }`.

## UI Surface

### Web — `apps/web/src/app/finance/InsightsTab.tsx` and `components/NarrativePanel.tsx`

The narrative query stays `scope: 'cashflow'` for the selected month, `retry: false`, `refetchOnWindowFocus: false`. It must not pass `force` on mount or on month change.

`NarrativePanel` states:

| State | What the user sees |
|---|---|
| First paint, query in flight, no data yet | Existing short skeleton. This is a DB read, not a Gemini wait. |
| `available: false` | Card: `אין עדיין ניתוח שמור` + button `צור ניתוח` |
| `available: true` | Headline, body, connections, watchlist as today. Footer: `עודכן {generatedAt in Asia/Jerusalem, he-IL date + time}` and, when `stale`, `הנתונים השתנו מאז הניתוח`. Button `עדכן ניתוח`. |
| User pressed the button | Button disabled, label `מעדכן…`. Previous text stays on screen. |
| `force` failed | Keep the previous text if any. Show `לא הצלחתי לעדכן את הניתוח` and leave the button enabled. |

The button calls `narrative.refetch` only after the query input includes `force: true` (a separate `useQuery` with `enabled: false`, or a mutation-style `utils.client` call). A plain `refetch()` of the idle query must not generate.

Remove the automatic "failure" treatment of a cache miss. `נסה שוב` is no longer the idle label.

### Mobile — `apps/mobile/app/(tabs)/finance.tsx`

Insights segment: `fetchFinanceNarrative(token)` without force, in parallel with the deterministic insights. Narrative card:

- Saved text + `עדכן ניתוח`.
- Empty: `אין עדיין ניתוח שמור` + `צור ניתוח`.
- Press calls `fetchFinanceNarrative(token, { force: true })` and replaces the card. Pull-to-refresh reloads insights and the stored narrative only.

### Cron wiring

- `deploy/crontab.example`: `30 2 * * *` POST `/api/cron/finance-narrative`.
- `scripts/local-cron.mjs`: `['finance-narrative', 1440]`, not in the boot-hit list.
- One line in `docs/deploy/cron-setup.md` if that file lists the jobs.

## Out of Scope

- Changing deterministic insights, charts, KPIs, categorization, or the CFO tab.
- A Gemini call for `trading` or `overview` on the daily cron. Those scopes still honor the same read-vs-force rule if something calls them.
- Push or chat delivery of the narrative.
- Editing the prompt in `packages/api/src/services/finance-narrative.ts`.
- Keeping a history of older narratives.

## Open Questions

None. Daily run is 02:30 UTC, after the existing bank sync at 01:45 UTC, current month cash flow only.
