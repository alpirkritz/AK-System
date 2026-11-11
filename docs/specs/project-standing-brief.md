# Project standing brief and trend line

> **Slug:** `project-standing-brief`
> **Status:** Implemented
> **Last Updated:** 2026-09-25

## Goal

Replace the score columns on the glance card with a single trend line, and let Alpir ask Gemini, on click, for a Hebrew brief of where the project stands, written only from analyses already saved.

## User Stories

- As Alpir, I want one quiet line of meeting quality over time, with atmosphere marked on the points, so I can see direction without a bar chart.
- As Alpir, I want a project brief written from the analyses already on the project, so I understand where it stands without reading every quote.
- As Alpir, I want that brief to run only when I click, so a page load does not call Gemini.
- As Alpir, I want to run it again, and to see when the current brief was written.
- As Alpir, I want the same brief on a meeting and on a recurring series when they belong to that project.

## Acceptance Criteria

- Given the glance card has at least two scored meetings, when it renders, then quality is a line from older (left) to newer (right), on a 0–10 axis. Each meeting is a dot on that line. The dot is teal when that meeting's mood/subtext reads warm, coral when it reads cold, and gray when the wording is unclassified. There are no columns.
- Given fewer than two scores, when the card renders, then the line is omitted and the four drill-down buttons stay.
- Given a project has at least one completed analysis, when Alpir clicks "כתוב תמצית", then Gemini receives the saved analyses for that project (date, title, topic, key insight, mood, subtext, score, score rationale) and the people trend sentences. It does not receive raw transcripts. The Hebrew reply is stored and shown in full, with wrapping.
- Given a brief exists, when the card renders, then it shows the stored text and "נותח לאחרונה" with the date and time in Asia/Jerusalem. "נתח שוב" replaces the stored text and updates the timestamp.
- Given a completed analysis on the project is newer than the brief, when the card renders, then it shows "יש שיחות חדשות מאז התמצית." The brief is not regenerated until Alpir clicks.
- Given Gemini fails, when the click finishes, then the previous brief stays, the button is enabled again, and the error is Hebrew: what failed and that he can try again. No raw API text.
- Given the click is in flight, when the card renders, then the button is disabled and reads "כותב תמצית…".
- Given a meeting or a series is tied to a project, when its glance card renders, then it shows that project's brief and the same two buttons. A meeting with no project shows "שייך לפרויקט כדי לכתוב תמצית." and does not call Gemini.
- Given the page loads and no brief exists, when the card renders, then Gemini is not called. The empty line is "עוד אין תמצית." and the button is "כתוב תמצית".

## Data Model

Additive columns on `projects` in both `packages/database/src/schema.ts` and `packages/database/src/schema.pg.ts`:

- `standing_brief` text, nullable. The last Gemini brief.
- `standing_brief_at` text, nullable. ISO time of the last successful write.

SQLite bootstrap in `packages/database/src/index.ts`: `ALTER TABLE projects ADD COLUMN standing_brief TEXT` and `ALTER TABLE projects ADD COLUMN standing_brief_at TEXT`.

No new table. The "newer analyses" hint is computed on read: max `meeting_analyses.updated_at` for the project's analysed meetings, compared with `standing_brief_at`.

## tRPC API

Extend `packages/api/src/routers/projects.ts`. Both procedures are `protectedProcedure`.

- `getStanding` query. Input `{ projectId: string }`. Returns `{ brief: string | null, briefAt: string | null, stale: boolean }`. Does not call Gemini.
- `writeStanding` mutation. Input `{ projectId: string }`. Loads the same project analyses already used by `projectWarmth` (up to 16). Calls Gemini (`GEMINI_MODEL`, else `gemini-2.5-flash`) with that compact payload and asks for a Hebrew brief of where the project stands: what is moving, the atmosphere, the people, and the quality, kept as four short paragraphs. Stores the text and timestamp. Returns the same shape as `getStanding` with `stale: false`. On Gemini failure, throws a Hebrew message and does not clear the previous brief.

`projects.getRelated` also returns `standing: { brief, briefAt, stale }` so the project page does not need a second round trip. Meeting and series glance cards call `getStanding` with the linked project id.

## UI Surface

- `apps/web/src/components/relationship/InsightStrands.tsx` — remove the column chart. Draw one polyline and one dot per meeting. Caption: "הקו: איכות השיחה. הנקודה: אווירה, חמה או קרה. משמאל ישן, מימין אחרון."
- Same component — replace the clamped latest insight with the stored brief. Buttons "כתוב תמצית" / "נתח שוב", the timestamp, and the stale hint. Drill-down buttons for תובנות, אווירה, אנשים, and ציון stay collapsed until clicked.
- `apps/web/src/app/projects/[id]/page.tsx` reads standing from `getRelated`.
- `apps/web/src/app/meetings/components/MeetingInsight.tsx` and `CircleCard.tsx` pass the linked project id into the same brief block.

## Out of Scope

- Calling Gemini on page load, on sync, or on a cron.
- Sending the brief to WhatsApp.
- Feeding raw transcripts into this prompt.
- A separate brief per meeting or per series. One brief per project.
- Changing how a single meeting is analysed.
- Mobile.

## Open Questions

None.
