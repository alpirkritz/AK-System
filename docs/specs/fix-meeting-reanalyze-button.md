# Fix Meeting Re-analyze Button

> **Slug:** `fix-meeting-reanalyze-button`
> **Status:** Draft
> **Last Updated:** 2026-09-09

## Goal

The "נתח מחדש" button on a completed meeting conversation analysis looks clickable but does nothing. The UI always calls `meetings.analyzeTranscript` with `force: false`, so the server returns the existing analysis and never re-runs Gemini. The same skip also blocks "נסה שוב" after a failed analysis. Users who disagree with an analysis (e.g. "important 1:1 w/ or") cannot request a new one.

## User Stories

- As a user viewing a completed conversation analysis, I want "נתח מחדש" to start a new Gemini run, so that a wrong analysis can be replaced.
- As a user whose analysis failed, I want "נסה שוב" to actually retry, so that a transient Gemini error is not sticky.
- As a user whose re-run fails (no transcript, Gemini error), I want to see an error message, so the button does not appear dead.

## Acceptance Criteria

- [ ] Given a meeting with a completed analysis, when the user clicks "נתח מחדש", then the client calls `meetings.analyzeTranscript({ meetingId, force: true })`.
- [ ] Given a meeting with a completed analysis and `force: true`, when the mutation runs, then a new analysis is produced (new or updated `meeting_analyses` row) and `getAnalysis` returns the new result, not the previous one.
- [ ] Given a meeting with a completed analysis and `force: false` (cron / first-click path), when `analyzeTranscript` is called, then the existing analysis id is returned and Gemini is not called.
- [ ] Given a meeting whose latest analysis has `status='failed'`, when the user clicks "נסה שוב", then the client calls `analyzeTranscript` with `force: true` and a new run is attempted.
- [ ] Given the user clicks "נתח מחדש" or "נסה שוב", when the mutation is in flight, then the UI shows the existing pending spinner copy ("מנתח את התמלול...") and the button is not usable.
- [ ] Given the mutation throws (no/short transcript, Gemini failure), when it settles, then a Hebrew error is visible on the analysis card and `getAnalysis` is refetched.

## Data Model

No schema changes. Existing `meeting_analyses` in `packages/database/src/schema.ts` and `schema.pg.ts` is reused.

`force: true` continues to insert a new `meeting_analyses` row (current router behavior). `getAnalysis` already returns the latest by `createdAt DESC`.

## tRPC API

No new procedures. Existing `meetings.analyzeTranscript`:

- Input: `{ meetingId: z.string().min(1), force: z.boolean().optional() }`
- Auth: `protectedProcedure`
- If a row exists and `force !== true`, return `{ analysisId }` of an existing row (unchanged).
- If `force === true` (or no row), create a new pending row, run Gemini, mark completed/failed.

Add Vitest coverage for the skip vs force paths (currently missing).

## UI Surface

Route: `apps/web/src/app/meetings/[id]/page.tsx` via `apps/web/src/app/meetings/components/ConversationAnalysis.tsx`.

- "נתח שיחה" (no analysis yet): keep `force: false`.
- "נתח מחדש" (completed): `force: true`.
- "נסה שוב" (failed): `force: true`.
- Pending: existing spinner.
- Mutation error: show under the header / on the failed card; do not stay silently on the old completed view with no feedback.

Mobile (`apps/mobile/components/ConversationAnalysis.tsx`): "נסה שוב" must also pass `force: true`. Completed-state refresh remains a reload, not a re-run (out of scope unless a re-analyze control already exists).

## Out of Scope

- Changing Gemini prompts or hat selection.
- Deleting historical `meeting_analyses` rows.
- Re-analyzing from a cron job (`force` stays false there).
- Transcript extraction / Notion sync.
- Auto-creating tasks from the new analysis.

## Open Questions

None — `force` was already specified in `docs/specs/meeting-transcript-deep-analysis.md`; the UI never passed it on re-run.
