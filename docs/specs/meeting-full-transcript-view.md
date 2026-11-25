# Spec: Show the full transcript on the meeting page

> **Slug:** `meeting-full-transcript-view`
> **Stack:** next-trpc-monorepo
> **Status:** Approved by user 2026-11-17 — implemented (Playwright e2e pending)
> **Created:** 2026-11-17

## Problem

Voice recordings are transcribed and stored (`voice_recordings.transcript_text` plus per-utterance
`voice_transcript_segments`), but the user cannot read them anywhere in the product.

- `apps/web/src/app/meetings/components/ConversationAnalysis.tsx` (~line 600): the "תמלול מלא"
  toggle renders the hard-coded string `התמלול יוצג כאן` (a leftover "would be fetched separately"
  stub). The transcript is never loaded.
- `/voice` (`apps/web/src/app/voice/page.tsx`) shows status, speakers and analysis, but no
  transcript text either (it only inspects `transcriptText` for failed-chunk markers).

Verified on production on 2026-11-17: all recordings of 16–17.11 are `completed` with a transcript
(e.g. "התייעצות עם ליאור": 43k chars, 352 segments). Nothing is wrong with transcription or the
backup; the data is simply not rendered.

## Goals

1. On a meeting page, the user can open the full transcript of the recording linked to that meeting,
   read it, and copy it.
2. The same transcript is reachable from the recording card on `/voice`.

## User stories

- As the user, on `/meetings/[id]` I expand "תמלול מלא" and see the conversation, grouped by
  speaker with timestamps, so I can find what was said.
- As the user, I can copy the whole transcript with one click (plain text, `דובר: טקסט` per line).
- As the user, when a speaker has been identified (`voice_speaker_identities`) I see the person's
  name instead of `דובר 1`.
- As the user, when a meeting has several recordings I can switch between them.
- As the user, if the transcript is empty, still processing, or failed, I see a clear Hebrew
  message instead of an empty box.

## Acceptance criteria

- [ ] The hard-coded `התמלול יוצג כאן` text is gone; expanding "תמלול מלא" loads real data.
- [ ] Segments render as speaker-labelled paragraphs with `mm:ss` start time; consecutive segments
      from the same speaker are merged visually.
- [ ] Identified speakers show the person's name; unidentified show the model label (`דובר N`).
- [ ] If there are no segments (diarization `failed`/`skipped`), fall back to `transcript_text`
      rendered as plain text, so a failed diarization never hides the transcript. (Production:
      three long recordings have `diarization_status = failed`, `Maximum call stack size exceeded`.)
- [ ] Failed-chunk markers (`[לא ניתן היה לתמלל את הקטע …]`) are shown, not stripped.
- [ ] "העתק תמלול" copies plain text; shows a short confirmation.
- [ ] A meeting with no recording shows "אין הקלטה לפגישה זו" (the toggle is hidden when there
      is no recording).
- [ ] Recording `status = processing` shows "התמלול בעבודה…"; `failed` shows the stored error.
- [ ] Long transcripts (1000+ segments) stay responsive: scroll container, no layout jump,
      no per-segment tRPC calls.
- [ ] RTL and dark theme correct; uses existing `.btn` / `.card` classes.
- [ ] `/voice` recording card gets the same "תמלול מלא" section via the shared component.

## Data model changes

None. Read-only over existing tables:

- `voice_recordings` (`meeting_id`, `created_meeting_id`, `transcript_text`, `status`, `error`,
  `diarization_status`)
- `voice_transcript_segments` (`recording_id`, `speaker_label`, `start_ms`, `end_ms`, `text`)
- `voice_speaker_identities` (label → person), resolved via existing helpers in
  `services/voice-diarization.ts` (`listRecordingSpeakers`).

No change to `schema.pg.ts` / `schema.ts`.

## tRPC API

Add to `packages/api/src/routers/voice.ts` (all `protectedProcedure`):

- `voice.transcript` — input `{ recordingId: string }` → 
  ```ts
  {
    recordingId: string
    status: 'uploaded' | 'processing' | 'completed' | 'failed'
    error: string | null
    diarizationStatus: string
    text: string | null                // transcript_text, the fallback
    segments: { speakerKey: string; speakerName: string | null; startMs: number; endMs: number; text: string }[]
  }
  ```
  Segments ordered by `start_ms`. `speakerName` resolved from `voice_speaker_identities` / people.
- `voice.recordingsForMeeting` — input `{ meetingId: string }` → `{ id, createdAt, duration, status }[]`
  (matches `meeting_id` or `created_meeting_id`), newest first.

Reuse `getVoiceRecording`/`listRecordingSpeakers`; put the query logic in `services/voice.ts`.
The meeting page must not use inline `fetch`; tRPC client only.

## UI surface

- New shared component `apps/web/src/app/voice/components/TranscriptView.tsx` (props:
  `recordingId`), used by:
  - `ConversationAnalysis.tsx` — replaces the stub; `meetingId` → `voice.recordingsForMeeting`
    → first recording (tab/select when more than one).
  - `apps/web/src/app/voice/page.tsx` — collapsible section on the recording card.
- Load lazily: query enabled only once the section is expanded.
- Needs the UI Designer pass (RTL, dark, copy button, long-list behaviour).

## Out of scope

- Editing or correcting transcript text.
- Search inside the transcript, audio playback sync, export to file.
- Fixing diarization `Maximum call stack size exceeded` (separate bugfix spec; this feature must
  simply not depend on diarization succeeding).
- Re-transcription controls (already exist via `voice.retry`).
- Surfacing audio that was removed by the 30-day audio cleanup (transcript text remains; audio
  playback is not part of this spec).

## Test plan

- Vitest: `voice.transcript` returns segments in order with identified names; falls back to
  `text` when no segments; NOT_FOUND for unknown id; `voice.recordingsForMeeting` matches both
  `meeting_id` and `created_meeting_id`.
- Playwright: seeded meeting with a recording and segments → expand "תמלול מלא" → speaker text
  visible; copy button works; meeting without recording hides the toggle.

## Open questions

1. When a meeting has multiple recordings, is a select box enough, or should they be concatenated?
2. Should the transcript also be shown on the `/voice` card in this change, or meeting page only?
3. Privacy: transcripts are sensitive. Any extra gating beyond the existing auth needed?
