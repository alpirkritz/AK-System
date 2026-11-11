# Retry a Failed Recording Upload Without Re-Recording

**Stack:** `apps/web` (browser recorder) + `apps/mobile` (Expo recorder)
**Slug:** `voice-upload-retry-without-rerecording`
**Status:** Draft
**Created:** 2026-09-30
**Triggered by:** the "ההקלטה גדולה מדי" bug (`voice-large-recording-transcription.md`) — the recording itself was fine, only the upload was rejected, but there was no way to resend it once the underlying bug is fixed; the user had to re-record the whole conversation.

---

## Why this happens today

**Web** (`apps/web/src/app/voice/page.tsx`, `stopAndUpload`): the recorded audio only exists as an in-memory `Blob`, local to that one function call. On any upload failure — a stale size cap, a dropped connection, a 500 — the function just sets an error message and returns; the `Blob` is never stored anywhere else and is gone once the function exits (garbage collected). There is no code path that could resend it even if you wanted to.

**Mobile** (`apps/mobile/app/(tabs)/record.tsx`, `stopAndUpload`): slightly better in one respect — `expo-audio` writes the recording to a real file on device storage at a `uri`, so the audio itself survives an upload failure. But the app still discards its only reference to that `uri` (a local variable) and resets to the consent screen, so from the user's perspective it's just as unrecoverable — the file exists on disk, orphaned, with no UI path back to it.

Neither platform's existing "נסה שוב" (retry) button helps here — that button only appears for recordings that already got a `recordingId` and failed later, during server-side transcription/analysis. A recording rejected at upload time never gets that far.

---

## Goal

When an upload fails for any reason, keep the already-captured audio available for a one-click resend — no re-recording, no re-granting microphone permission, no redoing the conversation.

---

## User Stories

1. **As a user**, when my recording fails to upload, I want a "שלח שוב" button that resends the exact audio I already recorded, so a transient failure (or a bug that gets fixed later) doesn't cost me the whole recording.
2. **As a user on mobile**, I want this to survive if I close and reopen the app while waiting to retry (e.g. waiting for a deploy), since the audio file itself is already sitting on my phone.
3. **As a user on web**, I want the same resend button within the same browser tab session, understanding that refreshing the page loses it (the audio only lives in browser memory) unless I keep the tab open.
4. **As a user**, if I start a brand-new recording while a failed one is still pending resend, I want to be warned before it's silently discarded.

---

## Acceptance Criteria

### Web
- **Given** an upload fails (any reason — size, network, server error)
- **Then** the recorded `Blob` and its duration are kept in component state, and the UI shows the error message plus a "שלח שוב" button instead of (or alongside) "התחל הקלטה"
- **Given** I click "שלח שוב"
- **Then** the same `Blob` is re-uploaded via the same multipart flow, with the same people/project/meeting selections as originally chosen, without re-invoking `getUserMedia` or the recorder at all
- **Given** the resend succeeds
- **Then** the pending failed upload is cleared and the flow continues exactly as a normal successful upload (navigates to the recording's result view)
- **Given** I click "התחל הקלטה" while a failed upload is still pending
- **Then** I see a confirmation ("יש הקלטה שממתינה לשליחה — להתחיל הקלטה חדשה בכל זאת ולמחוק אותה?") before the pending one is discarded
- **Given** I reload the page
- **Then** the pending failed upload is lost (in-memory only for web in this pass — see Open Questions) and the recorder returns to its normal idle state, same as today

### Mobile
- **Given** an upload fails
- **Then** the recording's `uri`, duration, and chosen people/project/meeting are persisted via the existing `storage` helper (SecureStore-backed, survives app restarts) under a dedicated key, and the idle/consent screen shows a "יש הקלטה שלא נשלחה" banner with "שלח שוב" and "מחק" actions instead of silently returning to a blank consent screen
- **Given** I reopen the app later (even after fully closing it)
- **Then** the pending-upload banner still appears, since both the audio file and its metadata persisted
- **Given** I tap "שלח שוב"
- **Then** the same file at the stored `uri` is re-uploaded with the stored metadata
- **Given** the resend succeeds, or I tap "מחק"
- **Then** the persisted entry is cleared; on delete, the audio file itself is also removed from device storage (avoid orphaned files accumulating)
- **Given** I start a new recording while a pending failed upload exists
- **Then** the same confirm-before-discard behavior as web applies

---

## Data Model Changes

None server-side. Purely client-side state/persistence:
- Web: React state only (`useState`), no storage API — intentionally ephemeral per this pass.
- Mobile: one `storage` key (e.g. `helm_pending_voice_upload`) holding JSON `{ uri, durationSeconds, personIds, meetingId, projectId, source, failedAt }`.

---

## UI Surface

- `apps/web/src/app/voice/page.tsx`: new `failedUpload` state; "שלח שוב" button rendered next to the existing error message; confirm-dialog (native `window.confirm` is fine here, consistent with this app's existing lightweight-dialog style) before discarding on a fresh "התחל הקלטה".
- `apps/mobile/app/(tabs)/record.tsx`: pending-upload banner on the consent/idle screen (checked on mount via the `storage` helper), "שלח שוב" / "מחק" actions, same confirm-before-discard on starting a new recording.

---

## Out of Scope

1. **Web persistence across a page reload** (IndexedDB-backed Blob storage) — real browsers can store `Blob`s in IndexedDB, but it's meaningfully more code (a small storage wrapper, cleanup policy) for a case users can work around today by just not closing the tab. Candidate fast-follow if this keeps coming up.
2. **Automatic retry** (e.g. exponential backoff on network errors) — this spec only makes a *manual* resend possible; auto-retry is a separate, smaller follow-up if wanted.
3. **Any change to why an upload fails** — this is purely about not losing the recording when it does; the actual bug from `voice-large-recording-transcription.md` is fixed separately.
4. **Multiple simultaneous pending failed uploads** — only the single most recent failed recording is tracked per platform; a second failure before resolving the first overwrites it (with the same confirm-before-discard protection).

---

## Open Questions

1. **Web IndexedDB persistence** (surviving a reload) — worth building now, or defer until someone actually loses a recording to a page refresh? Leaning defer, per Out of Scope above.
2. **Mobile orphaned-file cleanup** — if a user never taps "שלח שוב" or "מחק" for a very long time, the audio file sits on device storage indefinitely. Worth a max-age auto-cleanup later; not addressed in this pass.
3. **Multiple recordings across app restarts** — if this proves popular, a small list of pending-resend recordings (not just one) might be worth it — deferred until there's signal it's needed.

---

## Testing Notes

- Manual QA (web): force an upload failure (e.g. temporarily lower a size limit, or disconnect network mid-upload), confirm "שלח שוב" appears and successfully resends without re-recording; confirm starting a new recording while one is pending shows the confirm dialog.
- Manual QA (mobile): same failure-forcing, then fully close and reopen the app, confirm the pending-upload banner still appears and resend/delete both work correctly.
- No new backend surface, so no new Vitest coverage on `packages/api` — this is UI/state logic in `apps/web`/`apps/mobile`, covered by manual QA per this repo's existing convention for Expo-recording flows (Playwright doesn't cover microphone/device-storage-dependent behavior).
