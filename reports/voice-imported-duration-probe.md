# Review: voice-imported-duration-probe

**Verdict: APPROVED WITH NITS**

## Scope

`packages/api/src/services/voice.ts`, `packages/api/src/services/voice-chunked-transcription.test.ts`. Spec: `docs/specs/voice-imported-duration-probe.md`.

## Conformance

- `probeAudioDurationSeconds` (ffprobe, null on any failure or `N/A`) is used by `saveVoiceUpload`; the probed value replaces the client's and drives the 10s minimum. The written file is removed when the upload is then rejected (too short, unknown meeting).
- `processVoiceRecording` re-probes when it will read audio (no stored transcript, or `retranscribe`) and fixes a stored duration off by >5s, so the two failed imports chunk on retry without re-upload. Skipped when a test transcriber is injected.
- `VOICE_CHUNK_THRESHOLD_SECONDS` default 45 → 25 min; chunk length unchanged (20 min); both still env-overridable.

## Checks

- `vitest src/services/voice*`: 68/68 pass (4 new probe/threshold cases).
- `pnpm test`: 1376/1377. The one failure (`meeting-relationships.test.ts` › manual weekly series) passes in isolation with and without this change — shared-DB ordering flake, unrelated.
- `pnpm -r run lint`: clean. Web build runs as part of `pnpm deploy:ec2`.

## Nits

- The mobile import screen still sends a placeholder duration; harmless now, but it could read the duration client-side for an accurate pre-upload label.
- `ffprobe` is a runtime dependency already required by chunking (`ffmpeg`); present in the production image.
