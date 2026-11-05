# Review — voice-recording-never-lost

**Spec:** `docs/specs/voice-recording-never-lost.md`
**Date:** 2026-11-05
**Verdict:** APPROVED WITH NITS

## What changed

**Server (`packages/api`, `apps/web/src/app/api/voice`)**
- `services/voice.ts`: `saveVoiceUpload` split into write + `registerStoredVoiceFile` (shared registration for an audio file already on disk). Single-request upload behaviour unchanged.
- `services/voice-resumable-upload.ts` (new): file-based upload sessions under `<voiceStorageDir>/uploads/<uploadId>/`. Parts are idempotent and size-checked. `complete` streams the parts into one file, verifies the total size, registers it, and is idempotent (an in-process lock plus a stored `completedRecordingId`). Stale sessions (>7 days) are cleaned up opportunistically.
- Routes: `POST /api/voice/uploads`, `GET /api/voice/uploads/:id`, `PUT …/parts/:index` (raw bytes or `{ base64 }`), `POST …/complete`. Same auth as `/api/voice/upload`. Background processing and notification moved into the shared `_lib/start-processing.ts`.

**Web (`apps/web/src/app/voice`)**
- `lib/local-recordings.ts` (new): IndexedDB store. Every MediaRecorder chunk is persisted as it arrives, with session metadata kept in step with review choices.
- `lib/resumable-upload.ts` (new): 4 MB parts, 5 retries with backoff per step, resume via status, idempotent complete.
- `lib/use-recorder.ts`: `onStart`/`onChunk` hooks, `audioBitsPerSecond: 32000`.
- `page.tsx`: banner listing recordings not yet sent (send / delete with confirm), a "החיבור נקטע — ממשיך…" state, a backup-failed warning, a `beforeunload` prompt, and the local copy is deleted only after the server confirms. Starting a new recording no longer discards an unsent one.

**Mobile (`apps/mobile`)**
- `lib/pending-recordings.ts` (new): a list in `documentDirectory/voice-pending/index.json` (not SecureStore, which caps values at ~2 KB). The file is moved out of the cache on stop, and the legacy single-key value is migrated.
- `lib/resumable-upload.ts` (new): the same core as web, plus an RN transport (base64 ranged reads).
- `app/(tabs)/record.tsx`: the entry is persisted *before* review. Leaving during review or upload keeps the recording. Multiple pending recordings are supported, and the "start new and delete" prompt is gone.

## Checks

| Check | Result |
|---|---|
| `voice-resumable-upload.test.ts` (7) | ✅ pass |
| `resumable-upload.test.ts` web (6) + `pending-recordings.test.ts` (4) | ✅ pass |
| Playwright `voice-recording-never-lost.spec.ts` (2): record → reload in review → banner → send with part 0 connection-reset → completes; delete asks first | ✅ pass |
| `pnpm test` full suite | ⚠️ 7–17 random failures per run (FOREIGN KEY / missing rows across suites sharing one SQLite file). **Pre-existing**: the same pattern occurs with this change set aside (7 failed on the unchanged code), and every failing file passes in isolation, including `email-voice-commitments` and `voice-meeting-choices` (3/3 runs). |
| `next lint` | ✅ no warnings or errors |
| `pnpm --filter @ak-system/web build` | ✅ compiled. The new routes are listed as dynamic. |
| `tsc` mobile | ✅ clean |

## Nits / follow-ups
1. **Not verified on a device.** The mobile flow is typechecked and its list logic is unit-tested, but it hasn't run on a phone. It also needs a new APK build to ship.
2. **32 kbps transcription spot-check** (spec requirement) still needs one real recording after deploy.
3. The retry core is duplicated between `apps/web/.../resumable-upload.ts` and `apps/mobile/lib/resumable-upload.ts` (no shared client package). Both carry a "keep in step" note.
4. Imports (`import-recording.tsx`) still use the single-request upload. Out of scope, but they would benefit from the same path.
5. **Working-tree caution:** another session's uncommitted changes are present in the same files (`packages/api/src/services/voice.ts`, `index.ts` neighbours, `routers/voice.ts`, …). Commit this change separately with care.
