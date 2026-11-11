# Review — notion-ai-notes-late-transcript

**Spec:** `docs/specs/notion-ai-notes-late-transcript.md`
**Date:** 2026-11-11
**Verdict:** APPROVED WITH NITS

## What changed

- `meeting_notes.transcript_text` added (`schema.pg.ts`, `schema.ts`, SQLite bootstrap `ALTER` in `database/src/index.ts`). Prod is SQLite, so the column is added on boot.
- `services/notion-meeting-note-body.ts`
  - `shouldFetchNoteBody` re-fetches a note shorter than 100 chars when its meeting is 0–3 days old (`RECENT_SHORT_NOTE_REFETCH_DAYS`), regardless of `last_edited_time`.
  - `MEETING_NOTE_MAX_BLOCKS` 200 → 2000 (the reported page needed 315).
  - `upsertInPageMeetingNote` / `ensureMeetingPageNote` persist `transcriptText`.
  - `ensureMeetingPageNote` now tries each Notion token instead of returning after the first (multi-account setups).
  - New `analysableNoteText()` — transcript when ≥ 100 chars, else summary.
- `routers/meetings.ts` `analyzeTranscript`: on a short note with a Notion page id, calls `ensureMeetingPageNote` once, re-reads the note, then analyses `analysableNoteText`.
- `cron/transcript-analysis` and `services/analysis-backlog.ts`: analyse the transcript when present.

## Verification

- Real Notion page (Daz - Weekly, 2026-11-11, read-only): extractor returns 6,085-char summary + 33,472-char transcript (complete), 315 blocks.
- `pnpm test`: packages/api 141 files / 1549 tests, apps/web 49 files / 330 tests — all pass.
- New tests: `shouldFetchNoteBody — late Notion AI notes` (5), `analysableNoteText` (2), backlog transcript preference (1), `meetings.analysis-refetch.test.ts` (2).
- `pnpm -r run lint` — pass. `pnpm --filter @ak-system/web build` — pass.
- `pnpm e2e` not run: no UI change.

## Nits

- Meetings without AI notes are re-fetched every sync for 3 days (one Notion block call each). Bounded; acceptable.
- The cron's 30-minute "recently ended" window still uses server-local time; the backlog catches what it misses (out of scope per spec).
- The notes-DB sync path (`notion-graph-sync.ts` ~L808) still stores body only (out of scope).
