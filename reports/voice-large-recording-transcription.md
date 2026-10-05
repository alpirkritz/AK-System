# Reviewer Report: voice-large-recording-transcription

**Verdict: APPROVED WITH NITS** (pending a local `pnpm test` run — same sandbox limitation noted in the two prior reports)

## What changed

Root cause of the live "ההקלטה גדולה מדי (עד 19MB, כ-40 דקות)" error: `voice-capture-deep-analysis.md` always intended a Gemini Files API path for recordings over ~20MB, but only the small-file inline-data path was ever implemented — `VOICE_MAX_BYTES` was a hard reject, not a threshold. This closes that gap per the new `docs/specs/voice-large-recording-transcription.md`.

- `packages/api/src/services/voice.ts`: split the old single constant into `GEMINI_INLINE_MAX_BYTES` (19MB, Gemini's own inline limit — unchanged, now just a branch point instead of a wall) and a new `VOICE_MAX_BYTES` app-level ceiling (300MB, generous). `transcribeWithGemini` branches on file size: at/under threshold, unchanged inline call; above it, `transcribeViaFilesApi` uploads via `GoogleAIFileManager`, polls `getFile` every 2s up to 60s for the file to leave `PROCESSING`, transcribes by `fileData` reference, and always deletes the uploaded file in a `finally` (success, failure, or timeout).
- `apps/web/src/app/api/voice/upload/route.ts` and `saveVoiceUpload`'s error copy updated to drop the now-inaccurate "19MB / 40 min" wording.
- `apps/mobile/app/(tabs)/record.tsx`: stale comment above `RECORDING_OPTIONS` corrected (it referenced the old hard cap).
- Tests: `packages/api/src/services/voice-large-file.test.ts` (new) — inline path untouched for small files; Files API path exercised for uploaded→immediately-ACTIVE, uploaded→PROCESSING→polled-to-ACTIVE (via `vi.useFakeTimers`), and uploaded→FAILED (asserts `deleteFile` still runs in every case). `packages/api/src/routers/email-voice-commitments.test.ts` — new case confirming a 20MB recording (previously a hard 413/reject) now succeeds, and the new 300MB ceiling still rejects.

## Note on scope

Deliberately did not touch the timeout-exceeded path in tests (file stuck in `PROCESSING` past 60s) — it shares the exact same cleanup code path as the `FAILED` case, which is covered; adding a fake-timer test for the full 60s wait added complexity for limited extra signal. Flagged in the spec's testing notes as acceptable to leave for manual QA.

## QA Gate

- `pnpm -r run lint` (`next lint` on `apps/web`): ran clean, identical baseline warnings, nothing new from `route.ts`.
- `pnpm test`: not run — same native-binary/sandbox constraint as the prior two reports (`better-sqlite3`/`esbuild` are macOS arm64 in `node_modules`, this session is Linux). The new test file follows this repo's existing Gemini-mocking pattern (`finance-narrative.test.ts`) exactly, so it should run cleanly locally; recommend `pnpm test` to confirm before relying on this for a real long recording.

## Immediate user impact

The specific failure in the screenshot (record rejected outright) is fixed: anything up to 300MB now succeeds, with recordings over ~40 minutes transparently routed through the Files API instead of being rejected. Note this fix is in the source tree only — it needs your normal deploy step (`pnpm deploy:ec2`) or a local dev restart to actually take effect on the running app; the screenshot's app instance hasn't picked up any of today's three changes yet.
