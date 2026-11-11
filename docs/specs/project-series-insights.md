# Project and series insights, with automatic analysis

> **Slug:** `project-series-insights`
> **Status:** Implemented
> **Last Updated:** 2026-09-25

## Goal

Show the same meeting-quality trend on a project and on a recurring series, and analyze every transcript as soon as it enters the system. Right after a new analysis is saved, send that same analysis text to Alpir's WhatsApp. The full analysis stays on the meeting page.

## User Stories

- As Alpir, I want a project page to show whether its analysed meetings are warming, cooling, or steady, so I do not open each meeting to judge the project.
- As Alpir, I want a recurring meeting such as Algo 4.0 to show that same trend on the meeting itself, including when the trend is steady.
- As Alpir, I want a transcript that arrives from Notion or a recording to be analysed without clicking "נתח שיחה".
- As Alpir, I want the regular analysis text sent to my WhatsApp immediately after that analysis, so I can read it without opening the app.
- As Alpir, I want that WhatsApp sent once per analysis, so a retry does not repeat it.

## Acceptance Criteria

- Given analysed meetings, the project page, the meeting page, and a recurring series each show three separate strands: atmosphere (mood and subtext, in full), people (participants and each person's trend from all of their analysed conversations tied to the project), and score (meeting quality, with the rationale in full). A meeting shows this only after its analysis is completed. A person's trend is not the meeting score. Under 4 project conversations the person line says how many there were.
- Given fewer than 4 analysed meetings, when the page loads, then it says how many were analysed and that a trend appears after 4. Meetings with no analysis are not scored.
- Given a recurring series has analysed instances, when a meeting in that series opens, then the circle card shows the series trend even when it is stable, plus the latest scores. Under 6 analysed instances the existing "not enough yet" rule stays, and the count is still shown.
- Given a Notion transcript or a voice recording finishes analysis, when the row is saved as completed, then WhatsApp is sent once and `meeting_analyses.whatsapp_notified_at` is set.
- Given the same analysis is completed again or the cron sees it, when notify runs, then WhatsApp is not sent a second time.
- Given WhatsApp send fails, when notify runs, then the stamp stays empty so a later run can retry.
- Given the manual "נתח שיחה" button completes a new analysis, when it saves, then the same WhatsApp is sent. Returning an existing analysis does not send.
- The WhatsApp text is the same analysis already stored on the meeting (`formatAnalysisMessage`): hat, topic, mood, subtext, key insight, score, action items, kaizen, and the open question. It is not a separate summary.

## Data Model

Additive column on `meeting_analyses` in both `packages/database/src/schema.ts` and `schema.pg.ts`:

- `whatsapp_notified_at` text, nullable. Set only after a successful WhatsApp send.

SQLite bootstrap: `ALTER TABLE meeting_analyses ADD COLUMN whatsapp_notified_at TEXT` in `packages/database/src/index.ts`.

No new tables. Project trend is computed on read from existing `meetings.project_id` plus meetings linked through `meeting_note_projects`, joined to completed `meeting_analyses` with a score. Series trend stays `seriesWarmth` in `packages/api/src/services/warmth.ts`.

## tRPC API

- Extend `projects.getRelated` in `packages/api/src/routers/projects.ts` (protected query). Add `warmth` to the return: `{ trend, recentAvg, olderAvg, count, dataReason, timeline }` where `timeline` items are `{ meetingId, date, title, score, sentiment }`. Trend uses the last up-to-8 analysed meetings versus the previous up-to-8, and is null under 4. `dataReason` reuses `dataReason` from `warmth.ts`.
- No new router. `circles.get` already returns series `warmth`; the meeting UI reads it.
- WhatsApp notify is not a tRPC procedure. `notifyAnalysisOnWhatsApp(db, analysisId)` in `packages/api/src/services/analysis-whatsapp.ts` is called from Notion auto-analysis, voice processing, `meetings.analyzeTranscript`, and the transcript cron.

## UI Surface

- `apps/web/src/app/projects/[id]/page.tsx` — one glance card: latest insight, a trend chart (score bars, mood dots), and four buttons that open תובנות, אווירה, אנשים, or ציון. The detail stays closed until clicked.
- `apps/web/src/app/meetings/components/CircleCard.tsx` — show series trend and the latest scores whenever `warmth.count > 0`, including stable.
- Meeting page analysis stays as it is. The button remains for a forced re-analysis.

## Out of Scope

- Changing the person threshold (4) or the circle threshold (6).
- Analysing meetings that have no transcript.
- Backfilling WhatsApp for analyses completed before this column exists.
- A new score model or a second LLM pass for the WhatsApp text. The message is formatted from the saved analysis.
- Mobile project screen.

## Open Questions

None.
