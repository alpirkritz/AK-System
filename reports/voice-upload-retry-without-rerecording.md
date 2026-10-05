# Reviewer Report: voice-upload-retry-without-rerecording

**Verdict: APPROVED**

## What changed

Implements `docs/specs/voice-upload-retry-without-rerecording.md` — when a recording's upload fails (any reason), the already-captured audio is no longer discarded; the user can resend it with one tap/click instead of re-recording.

- **Web** (`apps/web/src/app/voice/page.tsx`): `stopAndUpload` refactored into a shared `doUpload(blob, durationSeconds)`; on failure it stores `{ blob, durationSeconds }` in new `failedUpload` state instead of dropping it. A "שלח שוב" button appears next to the error message and calls `retryUpload()`, reusing the same `Blob` with no new `getUserMedia`/recorder involvement. Starting a fresh recording while a failed upload is pending now confirms first (`window.confirm`) before discarding it. In-memory only, by design — lost on a page reload (documented in the spec as an accepted limitation for this pass).
- **Mobile** (`apps/mobile/app/(tabs)/record.tsx`): on upload failure, the recording's `uri` (the file itself already persists on device storage from `expo-audio`) plus duration/people/project/meeting are persisted via the existing `storage` helper (SecureStore-backed) under `helm_pending_voice_upload` — this **does** survive an app restart, unlike the web path, since it's metadata-only (small JSON) rather than an in-memory Blob. A banner on the consent screen offers "שלח שוב" / "מחק"; delete also removes the underlying audio file via `expo-file-system/legacy`'s `deleteAsync`. Starting a new recording with a pending failed upload confirms via `Alert.alert` before discarding.

## QA Gate — stronger than the prior two reports

This pass, `node --max-old-space-size=8192 tsc --noEmit` completed successfully (it OOM'd at default heap size in an earlier attempt this session) for **both** `apps/web` and `apps/mobile`'s full `tsconfig.json`. Results:

- `apps/mobile`: zero errors.
- `apps/web`: errors exist, but every one is in files this session never touched (`packages/api/src/services/warmth.ts`, `whatsapp-cluster-run.ts`, `whatsapp-daily-digest.ts`, `whatsapp-dm.ts`, and a pre-existing `packages/database` `pg`-module/circular-schema-reference issue also seen earlier this session) — all in this repo's substantial pre-existing uncommitted WIP (confirmed via `git status` showing ~100+ already-modified/untracked files before this session started). **None of the files touched by any of today's three fixes appear in the error output.**

Combined with the clean `next lint` pass (identical baseline warnings, nothing new), this is real, complete type-check coverage for this change — stronger verification than the two earlier reports today, which could only confirm lint. Retroactively, this same tsc run also re-confirms the `recording-auto-calendar-context` and `recording-call-audio-capture`/`voice-large-recording-transcription` changes from earlier in this session introduced no type errors either.

`pnpm test` (Vitest) still could not run — same `better-sqlite3`/`esbuild` native-binary-platform-mismatch constraint as all prior reports today; no new backend surface was added by this feature anyway (per the spec's Testing Notes, this is UI/state logic, manual-QA territory).

## Recommendation before relying on this

Manual QA on a real device/browser: force an upload failure (e.g. briefly point the app at a bad API URL, or disconnect network mid-upload), confirm resend works without re-recording on both platforms, and confirm the discard-confirmation dialogs appear correctly.
