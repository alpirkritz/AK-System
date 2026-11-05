# A Recording Is Never Lost — Durable Local Copy + Resumable Upload

**Stack:** `apps/web` (browser recorder) + `apps/mobile` (Expo recorder) + `packages/api` (voice service)
**Slug:** `voice-recording-never-lost`
**Status:** Approved (2026-11-05) — open questions resolved as recommended (32 kbps yes, no post-confirm grace copy)
**Created:** 2026-11-05
**Builds on:** `voice-upload-retry-without-rerecording.md` (whose web half was explicitly in-memory only — see its "Given I reload the page… lost").

---

## What happened

On 2026-11-03, between 20:40 and 21:02 Israel time, a full meeting recorded in the browser failed to upload and was lost. Production logs show three requests torn down mid-body at 18:40:50, 18:58:58 and 19:02:52 UTC (`Error: aborted … code: 'ECONNRESET'` from `abortIncoming`/`socketOnClose`). That means the connection closed before the whole file arrived, three times in a row. The web container had been recreated at 18:34 (a deploy), so earlier attempts aren't in the logs.

Two independent failures combined:

1. **The upload is one all-or-nothing HTTP request.** A long meeting is one 30–60 MB `multipart` POST through the ngrok free tunnel to a 1 GB EC2 box. Any blip (Wi-Fi switch, laptop sleep, tunnel reconnect, a deploy restarting `web`) kills the whole request, and a retry starts from byte 0. So a long recording on a flaky link can fail every time.
2. **On web, the audio lives only in page memory.** `use-recorder.ts` keeps chunks in a `useRef`, then `page.tsx` keeps the `Blob` in React state. Refreshing, closing the tab, navigating away, or the browser discarding the tab drops it. Nothing warns before leaving.

Mobile has a softer version of (2): `record.tsx` persists the pending upload only in the `catch` of a failed upload. If the app is killed or crashes during *review* or *uploading*, the reference is lost. The file also sits in the OS cache directory, which the system may purge.

---

## Goal

From the first second of recording until the server confirms it stored the file, the audio always has a durable copy on the device. Uploads survive connection drops by resuming where they stopped instead of starting over.

---

## User Stories

1. As a user recording in the browser, if the tab is reloaded, closed, or crashes — during recording, review, or upload — I reopen `/voice` and see "יש הקלטה שלא נשלחה" with **שלח** / **מחק**, holding everything recorded up to that moment.
2. As a user, if my connection drops mid-upload, the upload retries by itself and continues from where it stopped; I see progress, not a failure.
3. As a user, if retries are exhausted, the recording stays on the device and I can resend it later, even days later, after a restart.
4. As a mobile user, the same guarantees hold if the app is killed during review or upload.
5. As a user, the local copy is deleted only after the server confirms the recording is stored, or after I explicitly choose "מחק" and confirm.

---

## Acceptance Criteria

### Web — durable local copy
- While recording, each `MediaRecorder` chunk (existing 1s `timeslice`) is appended to IndexedDB (`ak-voice` DB, store `chunks`, keyed by `sessionId` + seq). A `sessions` store holds `{ sessionId, startedAt, mimeType, durationSeconds, state: 'recording'|'review'|'pending'|'uploading', meetingId, personIds, projectId, uploadId?, notes? }`, updated on pause/stop/review edits.
- If an IndexedDB write fails (quota, private mode), recording continues and a visible warning says the backup isn't working ("הגיבוי המקומי לא פעיל — אל תסגור את הדף"). It never blocks recording.
- On `/voice` load, any session not in a confirmed-uploaded state shows a banner per session: date/time, length, meeting title, with **שלח** (rebuilds the Blob from chunks → resumable upload) and **מחק** (confirm → deletes chunks + session).
- A session interrupted mid-recording (state still `recording`) is recoverable up to the last saved chunk. The duration is taken from elapsed chunk count.
- `beforeunload` shows the browser's leave prompt while state is recording / review / uploading.
- Local data is deleted only after the server's `complete` response returns a `recordingId`.
- Bitrate: `MediaRecorder` gets `audioBitsPerSecond: 32000` (speech-quality Opus, about 14 MB/hour instead of about 60), which shrinks every upload ~4×. Transcription quality must be spot-checked on one real recording before merge.

### Both — resumable chunked upload
- The client splits the file into 4 MB parts and uploads them sequentially through the new endpoints (below). Each part is retried up to 5 times with backoff (1s, 3s, 10s, 30s, 60s). Before resuming, the client asks the server which parts it already has and skips them.
- Progress = bytes acknowledged / total. A transient failure shows "החיבור נקטע — ממשיך…", not an error.
- Only after retries are exhausted does the UI show the error + **שלח שוב**, and the local copy stays.
- Duplicate `complete` calls for the same `uploadId` return the same `recordingId`, never create a second recording.
- The existing single-request `POST /api/voice/upload` stays (old APK builds, imports), unchanged.

### Mobile — durable local copy
- On stop, the file is moved from the cache dir into `documentDirectory/voice-pending/` **and** the pending entry (`helm_pending_voice_upload`) is written immediately, *before* review. It is updated when review choices change, and cleared only after `complete` succeeds or the user deletes.
- The pending key becomes a list (`PendingUpload[]`) so a second recording never forces deleting the first. The "התחל חדשה ומחק" prompt goes away; the old single-object value is migrated on read.
- Upload uses the same part endpoints. Parts are read with `expo-file-system` ranged reads (`position`/`length`, base64) and sent as base64 JSON. Check the SDK 56 docs at docs.expo.dev before choosing the API.

### Server
- A part write is idempotent: re-sending part *n* overwrites it.
- `complete` concatenates parts in order into the final audio file (streamed, never one big `Buffer`), then runs the same validation, DB insert, people/project logic and background `processVoiceRecording` as `saveVoiceUpload`. That shared logic is extracted so both paths call it with a file path.
- Upload sessions untouched for 7 days are deleted opportunistically whenever a new upload session is created (no extra cron).

---

## Data Model Changes

**None in `schema.pg.ts` / `schema.ts`.** Upload sessions are filesystem state under `voiceStorageDir()/uploads/<uploadId>/` (`meta.json` + `part-00000…`). That avoids a table for short-lived data, and they live on the same persistent volume as the audio.

---

## API (Next.js route handlers, not tRPC — binary bodies; same auth as `/api/voice/upload` via `resolveRequestSession`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/voice/uploads` | JSON `{ mimeType, totalBytes, partSize, durationSeconds, consentConfirmed, contextConfirmed, meetingId?, projectId?, personIds[], source, clientSessionId }` | `{ uploadId }`. The same `clientSessionId` returns the existing `uploadId`. |
| GET | `/api/voice/uploads/:id` | — | `{ receivedParts: number[], completedRecordingId?: string }` |
| PUT | `/api/voice/uploads/:id/parts/:index` | raw bytes (web) or JSON `{ base64 }` (mobile) | `{ ok: true, size }` |
| POST | `/api/voice/uploads/:id/complete` | JSON, optionally an updated context (people/project/meeting from review) | `{ recordingId }` |

Part size ≤ 8 MB is enforced, and `totalBytes` ≤ `VOICE_MAX_BYTES`.

---

## UI Surface
- `/voice`: a pending-recordings banner above the recorder (list, send/delete each), a "reconnecting" progress state, a backup-not-working warning, and the leave-page prompt.
- Mobile `record.tsx`: the existing pending banner becomes a list; same reconnecting state.
- Hebrew copy is reviewed by the UI Designer Agent (RTL, dark theme, `.btn`/`.card`).

---

## Tests
- Vitest (`packages/api`): parts out of order / re-sent / missing → `complete` rejects missing, assembles correctly; idempotent `complete`; same `clientSessionId` → same `uploadId`; cleanup of stale sessions.
- Vitest (`apps/web` lib): IndexedDB session store (fake-indexeddb) — append, rebuild Blob, delete after confirm; part-upload loop resumes after a simulated failure.
- Playwright: record → reload mid-review → banner appears → send succeeds; upload with a route that aborts part 2 once → still completes.
- Mobile: unit test for pending-list migration from the old single-object key.

---

## Out of Scope
- Uploading parts *while* still recording (live streaming to server). That's a natural next step once parts exist, but not needed to stop losses.
- Changing the ngrok free tunnel or the EC2 size.
- Recovering the 2026-11-03 recording. It never reached the server and lived only in that tab's memory.

## Open Questions
1. 32 kbps Opus: OK to lower, pending a transcription spot-check? (Recommended: yes.)
2. Keep the local copy for a short grace period (e.g. 24h) even after the server confirms, as belt-and-braces? (Recommended: no — the server copy is backed up daily.)
