# Auto-identify speakers in two-person recordings

> **Slug:** `auto-identify-two-person-speakers`
> **Status:** Approved
> **Last Updated:** 2026-10-13

## Goal

Use the existing self-voice match and the confirmed recording context to identify the other speaker in an unambiguous two-person conversation, show the automatic attribution to the user with a correction path, and ensure the meeting analysis uses resolved speaker names without retranscribing or uploading audio again.

## User Stories

- As the owner, I want the only other participant in a confirmed one-on-one recording to be attributed automatically once my own voice is identified, so that I do not answer a redundant speaker prompt.
- As the owner, I want to see which speakers were identified automatically and correct a wrong attribution.
- As the owner, I want analysis and action-item ownership to use resolved names, without paying for another audio transcription.
- As the owner, I want ambiguous conversations to remain manual, so that the system never guesses among multiple people.

## Acceptance Criteria

- [ ] Automatic attribution runs only when the transcript contains exactly two distinct speaker labels, one label is already mapped to the owner with `state='auto'`, and exactly one other confirmed person is linked to the recording.
- [ ] The remaining speaker label is stored in `voice_speaker_identities` with that other person's ID and `state='auto'`.
- [ ] No automatic attribution occurs if self-voice matching failed, the recording has other than two speaker labels, there is other than one non-owner confirmed participant, or an identity already conflicts with the inference.
- [ ] An inferred person is linked to the recording without creating duplicate `voice_recording_people` rows.
- [ ] `voice.speakers` returns the mapped person's name in addition to `personId`.
- [ ] The web recording result visibly labels automatic matches in Hebrew and provides a correction action using the existing people picker.
- [ ] Unresolved speakers continue to use the existing sample-and-identify flow; ambiguous recordings receive the existing notification.
- [ ] Before initial analysis, resolved speaker labels are replaced with names in an analysis-only transcript. `voice_recordings.transcript_text` remains in its existing `דובר N` format.
- [ ] If all speaker labels are resolved only after a manual identification or correction, the existing analysis is refreshed once from text only; transcription and audio upload are not repeated.
- [ ] Skipped speakers count as resolved but retain their original `דובר N` label in the analysis input.
- [ ] A manual correction replaces the automatic identity and refreshes the analysis when no unknown speakers remain.
- [ ] Existing recordings without timed segments or speaker identities retain their current behavior.

## Data Model

No schema changes. Reuse:

- `voice_transcript_segments` for speaker labels, text, and sample timing.
- `voice_speaker_identities` for per-recording mappings (`auto`, `identified`, `skipped`).
- `voice_recording_people` for confirmed people linked to the recording.
- `meeting_analyses` for the refreshed text analysis.

Both `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts` remain unchanged.

## tRPC API

Extend the existing authenticated procedures in `packages/api/src/routers/voice.ts`:

- `voice.speakers`
  - Input remains `{ recordingId: string }`.
  - Each result also returns `personName: string | null`.
- `voice.identifySpeaker`
  - Input remains `{ recordingId: string, speakerLabel: string, personId: string | null }`.
  - After storing the answer, attempt an analysis-only refresh when all labels are resolved and an existing analysis is present.
  - Return `{ state: 'identified' | 'skipped', analysisRefreshed: boolean }`.

No new public procedure is required. Both procedures remain `protectedProcedure`.

## UI Surface

Update `apps/web/src/app/voice/page.tsx`, specifically `SpeakerPrompt`:

- Continue showing unknown speakers with the existing sample, quote, people picker, and skip action.
- Show each `state='auto'` speaker as an automatic identification with the mapped person's name.
- Provide “לא נכון? תקן” to reveal the existing `PeoplePicker` and submit a corrected identity.
- Reuse `.card`, `.pill`, `.btn`, `.btn-ghost`, Hebrew RTL copy, and the existing responsive wrapping.
- Show mutation errors and a short updating state while a correction may refresh analysis.
- Invalidate `voice.speakers`, `voice.get`, and `voice.getAnalysis` after success.

## Out of Scope

- Saving or matching voiceprints for people other than the owner.
- Guessing in meetings with more than one possible external participant.
- Re-transcribing audio after speaker identification.
- Rewriting the stored `voice_recordings.transcript_text`.
- Correcting Gemini's timestamp accuracy or the audio sample HTTP Range behavior.
- Mobile speaker-identification UI.

## Open Questions

None. The user approved conservative one-on-one inference and text-only analysis refresh.
