# Identify all speakers, then save once

**Stack:** `next-trpc-monorepo`
**Slug:** `batch-speaker-identification`
**Status:** Approved (requested by Alpir, 2026-11-12)
**Builds on:** `identify-unknown-speakers.md`, `auto-identify-two-person-speakers.md`

---

## Goal

On a recording, I match every speaker to a person first and press one button at the end. Today each "זה הוא" / "שמור תיקון" sends its own request and re-runs the analysis, so naming three speakers means three waits — and the summary only refreshes once *every* speaker is answered, so one leftover speaker (e.g. a one-second "טוב, מה קורה?") blocks it entirely.

## Current behaviour (verified)

- `apps/web/src/app/voice/page.tsx` `SpeakerPrompt`: each speaker row has its own submit; each calls `voice.identifySpeaker`.
- `voice.identifySpeaker` saves one answer, then `refreshVoiceAnalysisAfterSpeakerResolution` re-runs Gemini — but only when no speaker is still `unknown` (`attributed.allResolved`).
- Observed in prod (recording `vr_mwd9w6h8_rtc2yz`): speakers 1 and 2 identified, speaker 3 (one 1-second segment) unknown → analysis never refreshed after the correction.

## User stories

1. As a user, I pick a person (or "לא מזהה") for each speaker and press one button; the answers are saved together and the summary is rebuilt once.
2. As a user, if I leave a speaker unanswered, the summary still updates with the names I did give.
3. As a user, if the summary update fails, I still keep my speaker answers and see that only the summary failed.

## Acceptance criteria

- **Given** the "מי מדבר?" panel, **then** speaker rows have no per-row submit button. Choosing a person, or "לא מזהה", only marks the row locally (the row shows the choice and can be changed or cleared).
- A single primary button **"שמור זיהוי"** sits under the rows. It is disabled while nothing is marked, and its label counts the marked speakers when more than one (e.g. "שמור זיהוי (3)").
- Auto-identified rows keep "לא נכון? תקן"; correcting one marks it like any other row. Untouched auto rows are not sent.
- **When** I press "שמור זיהוי", **then** one request (`voice.identifySpeakers`) saves every marked answer, then re-runs the analysis once.
- The analysis re-runs even if some speakers are still unknown; those keep their "דובר N" label in the analysed text.
- The analysis is not re-run when the named transcript is unchanged (e.g. only "לא מזהה" answers).
- If the analysis fails, the answers are still saved; the panel shows "הזיהוי נשמר, אבל עדכון הסיכום נכשל" and the old summary stays.
- While saving, the button is disabled and the panel shows "שומר ומעדכן את הסיכום…".
- `voice.identifySpeaker` (single answer) keeps working unchanged for any other caller.

## Data model changes

None. Answers go to the existing `voice_speaker_identities` and `voice_recording_people`.

## tRPC API

`voice.identifySpeakers` — `protectedProcedure.mutation`

```ts
input: {
  recordingId: string
  answers: Array<{ speakerLabel: string; personId: string | null }> // 1..20, null = "לא מזהה"
}
output: {
  saved: Array<{ speakerLabel: string; state: 'identified' | 'skipped' }>
  analysisRefreshed: boolean
  analysisError: string | null
}
```

- Labels that are not speakers of this recording are ignored; a repeated label keeps its last answer.
- Service: `refreshVoiceAnalysisAfterSpeakerResolution(db, id, { requireAllResolved: false })`. The default stays `true` so the single-answer path is unchanged.

## UI surface

`apps/web/src/app/voice/page.tsx` → `SpeakerPrompt` only. RTL, dark theme, existing `.btn` / `.btn-primary` / `.btn-ghost` / `.card` classes.

## Out of scope

- Splitting one speaker label between two people (per-line edits).
- Re-opening a speaker that was already confirmed by the user.
- Removing a wrongly auto-tagged person from the recording's participants.
- A named-transcript viewer.

## Open questions

None.
