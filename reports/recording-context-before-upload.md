# Review: recording-context-before-upload

> **Slug:** `recording-context-before-upload`
> **Status:** APPROVED
> **Date:** 2026-10-13

## Verdict: APPROVED

All completion criteria from `docs/specs/recording-context-before-upload.md` are met.

---

## Checklist

| Criterion | Status |
|---|---|
| Spec exists at `docs/specs/recording-context-before-upload.md` | ✅ |
| UI/UX: review step renders before upload (web + mobile) | ✅ |
| Web: `stopAndReview` replaces `stopAndUpload`; review panel with "העלה שיחה" | ✅ |
| Web: "ביטול" discards blob and returns to idle | ✅ |
| Web: calendar-meeting recordings pre-populate people + project in review | ✅ |
| Mobile record: `'review'` phase added; `stopRecording` / `confirmUpload` / `discardReview` | ✅ |
| Mobile record: `beforeRemove` guard includes `'review'` | ✅ |
| Mobile import: `'review'` phase added after file pick + consent | ✅ |
| `RecordingContextEditor` extracted to `apps/mobile/components/RecordingContextEditor.tsx` | ✅ |
| Backend: `AnalyzeTranscriptOptions` extended with `projectName?`, `knownPeople?` | ✅ |
| Backend: `buildAnalysisPrompt` includes CONTEXT block when data is present | ✅ |
| Backend: `processVoiceRecording` loads role/company profiles and project name | ✅ |
| Backend: meeting title updated from `analysis.topic` only for voice-created placeholders | ✅ |
| Backend: calendar/manually-edited titles are never overwritten | ✅ |
| Backend: title truncated to 120 chars | ✅ |
| Existing test updated: placeholder title now expects renamed value | ✅ |
| 7 new Vitest tests in `recording-context-before-upload.test.ts` — all pass | ✅ |
| `pnpm test` — 1300+ pass, 1 pre-existing failure in `harness-reasoner.test.ts` (unrelated) | ✅ |
| `pnpm -r run lint` — no new errors, only pre-existing warnings | ✅ |
| `pnpm --filter @ak-system/web build` — clean build, 0 errors | ✅ |

---

## Files Changed

| File | Change |
|---|---|
| `docs/specs/recording-context-before-upload.md` | New PM spec |
| `apps/web/src/app/voice/page.tsx` | `stopAndReview`, review panel, `confirmUpload`, `cancelReview` |
| `apps/mobile/app/(tabs)/record.tsx` | `'review'` phase, `stopRecording`, `confirmUpload`, `discardReview`, navigation guard |
| `apps/mobile/app/(tabs)/import-recording.tsx` | `'review'` phase, `RecordingContextEditor` integration |
| `apps/mobile/components/RecordingContextEditor.tsx` | **New** shared component (extracted from record.tsx) |
| `packages/api/src/services/meeting-analysis.ts` | `AnalyzeTranscriptOptions` + `buildAnalysisPrompt` extended |
| `packages/api/src/services/voice.ts` | `processVoiceRecording`: enriched Gemini call + title rename |
| `packages/api/src/routers/email-voice-commitments.test.ts` | Updated expected placeholder title |
| `packages/api/src/services/recording-context-before-upload.test.ts` | **New** 7-test suite |

---

## Notes

- **Back-compatibility:** Old API clients (web/mobile before this change) continue to work. The review gate is UI-only; the server never requires `personIds`.
- **Mobile dependency:** `RecordingContextEditor` moved from inline to `components/`. Both `record.tsx` and `import-recording.tsx` import from the shared location. `TextInput` import removed from `record.tsx`.
- **Pre-existing failure:** `harness-reasoner.test.ts` had 1 failing test before this change and remains unrelated.
