# Review — batch-speaker-identification

**Spec:** `docs/specs/batch-speaker-identification.md`
**Date:** 2026-11-12
**Verdict:** APPROVED WITH NITS

## What changed

- `packages/api/src/services/voice-diarization.ts` — `identifySpeakers()` saves several answers; ignores labels the recording lacks; last answer per label wins.
- `packages/api/src/services/voice.ts` — `refreshVoiceAnalysisAfterSpeakerResolution` takes `requireAllResolved` (default `true`, single-answer path unchanged).
- `packages/api/src/routers/voice.ts` — `voice.identifySpeakers` mutation: saves the batch, refreshes the analysis once with `requireAllResolved: false`, returns `analysisError` instead of throwing when Gemini fails.
- `apps/web/src/app/voice/page.tsx` `SpeakerPrompt` — rows only mark a choice (person, or "לא מזהה" toggle with `aria-pressed`); one primary "שמור זיהוי (N)" button sends everything; partial-failure message "הזיהוי נשמר, אבל עדכון הסיכום נכשל".

## UI review

- RTL, dark theme, existing `.btn` / `.btn-primary` / `.btn-ghost` / `.card` classes; no new colours except Tailwind `amber-300` for the partial-failure note (already used in `NotConnectedBanner`).
- Save button full width on phones (`w-full sm:w-auto`), 44px-friendly.

## Verification

- New `voice-batch-speakers.test.ts` (4): batch save rules; refresh with one speaker left unknown (analysed text keeps "דובר 3"); no model call when nothing changes; Gemini failure keeps answers and old summary.
- Existing speaker suites (`voice-speakers`, `voice-chosen-people`) — pass unchanged.
- e2e `email-voice-commitments` (correction flow now goes through the save button) and `recording-uses-chosen-people` — 8/8 pass.
- `pnpm test` (api 1553, web 330), `pnpm -r run lint`, `pnpm --filter @ak-system/web build` — pass.

## Nits

- Refresh is still synchronous (~30 s with Gemini); the button shows a pending state meanwhile.
- A wrongly auto-tagged person is not removed from the recording's participants on correction (out of scope).
