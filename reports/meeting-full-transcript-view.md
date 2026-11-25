# Report: meeting-full-transcript-view

Spec: `docs/specs/meeting-full-transcript-view.md` · Date: 2026-11-17 · Author self-check (no independent reviewer run yet)

## Verdict: APPROVED WITH NITS (pending Playwright e2e)

## What changed
- `packages/api/src/services/voice-transcript.ts` (new): `getRecordingTranscript`, `listRecordingsForMeeting`.
- `packages/api/src/routers/voice.ts`: `voice.transcript`, `voice.recordingsForMeeting`.
- `apps/web/src/app/voice/lib/transcript.ts` (+test): grouping, timestamps, plain-text copy.
- `apps/web/src/app/voice/components/TranscriptView.tsx` (new), `apps/web/src/app/meetings/components/MeetingTranscript.tsx` (new).
- `ConversationAnalysis.tsx`: hard-coded `התמלול יוצג כאן` stub replaced by `MeetingTranscript`.
- `apps/web/src/app/voice/page.tsx`: "תמלול מלא" section on the recording card.
- No schema changes.

## Checks
- `voice-transcript.test.ts`: 7 new tests pass (ordering, identified/skipped speaker names, diarization-failed fallback, processing/failed state, NOT_FOUND, meeting_id + created_meeting_id matching).
- `transcript.test.ts`: 4 new tests pass.
- `pnpm test`: 54 files / 352 tests pass (web+mobile libs). `@ak-system/api`: 148 files / 1618 tests pass.
- `pnpm -r run lint`: no errors; only pre-existing warnings in unrelated files.
- `pnpm --filter @ak-system/web build`: succeeds.

## Nits / not done
- Playwright e2e from the spec's test plan was NOT written or run.
- No UI Designer pass yet (RTL/dark look was only checked by reading, not visually).
- Not visually verified in a browser, and not deployed; production still shows the old stub until `pnpm deploy:ec2`.
- Raw `tsc --noEmit` in `apps/web` reports many unrelated errors in this checkout (unresolved `drizzle-orm`, `better-sqlite3`); the Next build is the authoritative type check.
- Open questions in the spec (multi-recording behaviour: implemented as a select; `/voice` included) still await the user's confirmation.
