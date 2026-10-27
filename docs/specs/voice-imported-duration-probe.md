# Imported recordings: measure real duration on the server

> **Slug:** `voice-imported-duration-probe`
> **Status:** Approved — user asked to fix and deploy (2026-10-27)
> **Type:** Bugfix

## Goal

Imported recordings (mobile "ייבוא הקלטה") fail to transcribe when they are long. The mobile import screen does not know the file's length and always sends `durationSeconds = 11`, so the server never takes the chunked long-recording path: a 73-minute file (27MB) went to Gemini as one Files-API request and failed with `fetch failed`, and a 31-minute file (11MB) went as one inline request and came back empty. The server should measure the real duration itself and chunk anything long enough to be at risk.

## Root cause (verified in production, 2026-10-27)

| Recording | Stored `duration` | `ffprobe` duration | Result |
|---|---|---|---|
| `vr_mvqdhcv0_s767x2` (imported, 27MB) | 11 | 4380s | `fetch failed` on one 73-min request |
| `vr_mvqgd1qx_evjgal` (imported, 11MB) | 11 | 1838s | empty transcript from one 31-min request |

Live recordings of 54–59 min on the same model (`gemini-3.8-flash`) succeeded because their real duration triggered chunking. The model is not the cause.

## Acceptance criteria

- [ ] On upload, the server reads the file's duration with `ffprobe`; when it succeeds, that value is stored instead of the client's.
- [ ] When `ffprobe` is unavailable or the container has no duration (e.g. some MediaRecorder webm), the client value is kept — no upload is rejected because probing failed.
- [ ] `processVoiceRecording` re-probes before choosing the transcription path and corrects a stored duration that is off by more than 5 seconds, so retrying an already-failed import takes the chunked path without re-uploading.
- [ ] Recordings longer than 25 minutes (was 45) are chunked; chunk length stays 20 minutes. Both remain overridable via `VOICE_CHUNK_THRESHOLD_SECONDS` / `VOICE_CHUNK_DURATION_SECONDS`.
- [ ] The minimum-length check (10s) uses the probed duration when available.

## Data model

No schema change. `voice_recordings.duration` is now server-measured when possible.

## tRPC API

No shape change. `voice.retry` benefits automatically via `processVoiceRecording`.

## UI surface

None. Recording cards show the corrected length after the next fetch.

## Out of scope

- Mobile import screen reading duration client-side (server-side probe makes it unnecessary; no APK rebuild).
- Changing the transcription model.

## Rollout

Deploy, then retry the two failed imports from production.
