# Review: voice-imported-duration-probe

**Verdict: APPROVED WITH NITS**

## Scope

`packages/api/src/services/voice.ts`, `voice-chunked-transcription.test.ts`, `voice-large-file.test.ts`. Spec: `docs/specs/voice-imported-duration-probe.md`.

## Conformance

- `probeAudioDurationSeconds` (ffprobe; null on failure or `N/A`) is used by `saveVoiceUpload`: the probed value replaces the client's and drives the 10s minimum. The written file is removed when the upload is then rejected (too short, unknown meeting).
- `processVoiceRecording` re-probes when it will read audio and fixes a stored duration off by >5s, so the failed imports chunk on retry without re-upload. Skipped when a test transcriber is injected.
- Chunking: threshold 45 → 12 min, chunk 20 → 10 min (env-overridable). Rationale documented next to the constants (Node fetch 300s headers timeout vs. measured gemini-3.8-flash latency).
- `TRANSCRIBE_MAX_ATTEMPTS` 2 → 3; `generateWithFallback` tries `GEMINI_MODEL` then `VOICE_TRANSCRIBE_FALLBACK_MODEL` (default `gemini-3.1-pro-preview`) in both the inline and Files-API paths; the Files-API upload is reused across models.
- Error text now names `blockReason` when there are no candidates.
- Chunk loop calls `onChunkDone` → `updatedAt` refreshed per chunk, keeping `voice.retry`'s stuck check from double-starting a long run.

## Checks

- `vitest src/services/voice* src/routers/email-voice-commitments.test.ts`: 87/87 (new: probe ×3, threshold, fallback, blockReason).
- `pnpm test` (earlier in this change): 1376/1377; the one failure (`meeting-relationships.test.ts` › manual weekly series) passes in isolation with and without this change — shared-DB ordering flake, unrelated.
- `pnpm -r run lint`: clean. Web build runs inside `pnpm deploy:ec2`.

## Nits

- Web `/voice` and mobile `isVoiceStuck` judge "stuck" from `createdAt`, so a retried old recording shows "נתקע" while it is actually processing. Server-side retry is protected (uses `updatedAt`); switching the clients to `updatedAt` is a small follow-up (mobile needs an APK).
- Fallback to the pro model costs more per chunk; it only runs after 3 primary failures.
- The mobile import screen still sends a placeholder duration; harmless now that the server probes.
