# Notion AI notes that finish after the first sync

**Stack:** `next-trpc-monorepo`
**Slug:** `notion-ai-notes-late-transcript`
**Status:** Approved (bugfix)
**Created:** 2026-11-11

---

## Goal

Make conversation analysis work for meetings recorded with Notion AI Meeting Notes, even when the Notion sync first sees the page while the notes are still being generated, and analyse the real conversation (raw transcript) rather than only the AI summary.

## Problem (observed 2026-11-11, "Daz - Weekly" 17:30)

- Notion page had a `transcription` widget with `status: notes_ready`, a 29-block summary and a 100+ line transcript.
- The app's `meeting_notes.body_text` held only the widget title (`Daz - Weekly 2026-11-11T17:30:00.000+02:00`, < 100 chars).
- "נתח שיחה" failed with `No transcript available or transcript too short`; the auto-analysis cron and backlog skipped the meeting.

Root causes:
1. The sync fetched the page body while the meeting was in progress (only the title existed). `shouldFetchNoteBody` refetches only when the page's `last_edited_time` (minute granularity, and not reliably bumped when Notion AI writes into the widget) is newer than `body_synced_at`, so the note stayed stuck on the title.
2. `fetchMeetingNoteBody` extracts `transcriptText` but nothing persists it; every analysis path uses `body_text` (the summary). This contradicts `meeting-transcript-deep-analysis.md` ("summary and raw transcript are extracted and stored separately").
3. The block budget (200) is shared by summary and transcript, so long transcripts are truncated.

## User stories

1. As a user, after a recorded meeting ends I want its analysis to run on its own, even if the sync caught the page mid-meeting.
2. As a user, when I click "נתח שיחה" I want the app to pull fresh notes from Notion instead of failing on a stale copy.
3. As a user, I want the analysis to read the actual conversation, not only Notion's summary.

## Acceptance criteria

- **Given** a meeting-page note whose stored body is shorter than 100 chars and whose meeting date is within the last 3 days, **when** the Notion sync runs, **then** the page body is re-fetched regardless of `last_edited_time`.
- **Given** a note older than 3 days with a short body, **then** the existing `last_edited_time` rule applies (no endless refetch of meetings that never had AI notes).
- **Given** a Notion AI notes widget with a transcript, **when** the body is fetched, **then** the raw transcript is stored in `meeting_notes.transcript_text` (cap 50,000 chars) next to the summary in `body_text`.
- The block budget is high enough that a ~1,000-line transcript is not truncated by the budget (2,000 blocks).
- **Given** a stored note with < 100 chars of usable text that is linked to a Notion page, **when** `meetings.analyzeTranscript` runs, **then** it re-fetches the page from Notion once and re-reads the note before deciding the transcript is too short.
- `meetings.analyzeTranscript`, the `transcript-analysis` cron and the analysis backlog all analyse `transcript_text` when it has ≥ 100 chars, otherwise `body_text`.
- With no Notion link and a short body, `analyzeTranscript` still throws `No transcript available or transcript too short`.

## Data model changes

`meeting_notes.transcript_text TEXT NULL` — raw Notion AI transcript.

- `schema.pg.ts`: `transcriptText: text('transcript_text')`
- `schema.ts`: same, SQLite mirror.
- `database/src/index.ts` bootstrap: `ALTER TABLE meeting_notes ADD COLUMN transcript_text TEXT`.

## tRPC API

No new procedures. `meetings.analyzeTranscript` behaviour changes as described above (same input/output).

## UI surface

None. The meeting page's Notion summary card keeps showing `body_text`.

## Out of scope

- Notes from the separate notes database (`notes_db` path) — they keep using the body only.
- Fixing the cron's 30-minute "recently ended" window and server-timezone math; the backlog drains anything it misses.

## Open questions

None.
