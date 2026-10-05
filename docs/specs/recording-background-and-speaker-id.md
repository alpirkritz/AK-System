# Background Recording (Android) + Background Tab Recording (Web) + Automatic Speaker Identification

**Stack:** `next-trpc-monorepo` (backend) + `expo` (mobile, Android only for this spec) + `apps/web` (browser)
**Slug:** `recording-background-and-speaker-id`
**Status:** Draft
**Created:** 2026-09-28
**Depends on / supersedes scope from:** `voice-capture-deep-analysis` (this spec explicitly reverses its Out-of-Scope items 4 and 6, and keeps item 8 — no cloud storage — unchanged)

---

## Goal

Today, recording a conversation requires the app to stay open and in the foreground (mobile) or the browser tab to stay active/focused (web) — locking the phone or switching tabs stops or pauses the recording. This spec makes recording survive backgrounding on both platforms, and adds automatic speaker identification so a transcript can say "this is Alpir" vs. "this is someone else" without manual per-recording tagging.

Scope is **Android only** for mobile (the user's device is a Samsung Galaxy Z Fold 7); iOS background recording is out of scope for this spec. Audio retention policy is **unchanged** — files are kept indefinitely on disk, as today; no auto-delete is introduced by this spec.

---

## User Stories

1. **As a user**, I want to start a recording on my Android phone (Z Fold 7), lock the screen or switch apps, and have the recording continue uninterrupted, so I don't have to keep the phone unlocked and the app open for the whole meeting.

2. **As a user**, I want recording to keep working correctly whether my Fold is open (unfolded, using the inner screen) or closed (using the cover screen) and while switching between those states, so folding my phone mid-recording doesn't drop audio or crash the session.

3. **As a user**, I want a persistent notification while a background recording is active, so I always know recording is in progress and can stop it without reopening the app.

4. **As a user**, I want to start a recording in the web app, switch to another tab or window, and have the recording keep capturing audio, so I can reference other material during a recorded call without stopping the recording.

5. **As a user**, when I open a completed transcript, I want segments where I'm speaking automatically labeled as me, without manually tagging myself every time; I'm fine continuing to manually tag other participants as today.

6. **As a user**, I want to bring an externally-recorded phone call (e.g. Samsung's native call recorder) into the app, so it gets transcribed and gets the same automatic "is this me talking" labeling as a recording made inside the app.

---

## Acceptance Criteria

### Android Background Recording

- **Given** I start a recording on Android
- **When** I lock the screen, switch to another app, or the app is backgrounded
- **Then** recording continues without interruption, backed by a foreground service with an ongoing notification ("מקליט פגישה — הקש לעצירה")
- **Given** a background recording is active
- **When** I tap the notification
- **Then** the app opens back to the active recording screen (elapsed time, stop button)
- **Given** a background recording is active
- **When** I tap "Stop" from the notification's action button
- **Then** recording stops and upload begins, same as stopping from in-app

### Fold-State Resilience

- **Given** a recording is active
- **When** I fold or unfold the device (configuration change: screen switch, display size/orientation change)
- **Then** the recording session is not interrupted, restarted, or duplicated (validated by not tying the recording lifecycle to the Activity lifecycle — it lives in the foreground service, which survives configuration changes)
- **Given** the app is reopened after a fold/unfold transition
- **Then** the UI reflects the current recording state (elapsed time continues correctly, not reset)

### Interruption Handling

- **Given** a background recording is active
- **When** a phone call comes in or another app requests the microphone
- **Then** recording pauses automatically and resumes (or prompts to resume) after the interruption ends, and this is reflected in the notification and in-app state

### Web Background-Tab Recording

- **Given** I start a recording in the web app
- **When** I switch to another browser tab or another application window (tab loses focus/visibility)
- **Then** `MediaRecorder` capture continues uninterrupted (audio-only capture is not subject to background-tab timer throttling)
- **Given** a recording is active
- **When** the tab is backgrounded
- **Then** the app requests a Screen Wake Lock (`navigator.wakeLock`) to reduce the chance of the OS/browser suspending the page or letting the display sleep, released automatically when recording stops
- **Given** the Wake Lock API is unavailable or the request fails (unsupported browser, battery saver, etc.)
- **Then** recording still proceeds, with a one-time inline notice that background reliability isn't guaranteed on this browser
- **Given** the system itself sleeps (display sleep with app suspension, lid closed) rather than just the tab losing focus
- **Then** recording will still stop — this is a known, disclosed limit (OS-level suspension cannot be prevented from a browser tab), not a bug

### Automatic Speaker Identification (Self Only — MVP)

- **Given** I have not yet enrolled my voice
- **When** I open recording settings for the first time after this feature ships
- **Then** I'm prompted to record a short (~20-30s) reference sample, read from an on-screen prompt, used to build my voice embedding
- **Given** my voice is enrolled
- **When** a new recording is transcribed
- **Then** the system performs speaker diarization on the raw audio (segmenting by speaker), computes a voice embedding per speaker segment, and compares it against my stored embedding via similarity scoring
- **Given** a speaker segment's similarity to my embedding exceeds the match threshold
- **Then** that segment is labeled with my name in the transcript automatically
- **Given** a speaker segment does not match my embedding
- **Then** it is labeled "דובר לא מזוהה" (unidentified speaker) by default — same as today, the existing manual "attach person" flow is used to name other participants; **this spec does not build automatic recognition of anyone besides me**
- **Given** diarization/matching fails or errors
- **Then** transcription and analysis still complete using the existing Gemini-only relative labeling ("דובר 1"/"דובר 2") as a fallback — voice ID is additive, never blocking

**Note:** the data model below (`voice_prints.personId` as an FK) is kept general rather than a single hardcoded "self" row, purely so that expanding to other contacts later is a small follow-up rather than a schema rewrite — but only one row (Alpir's) is actually created or used by this spec.

### Importing External Recordings (Phone Calls)

- **Given** I have a call recording saved on my phone (e.g. Samsung's native call recorder on the Z Fold 7, saved as `.3gp`/`.m4a` under the device's Call Recordings folder)
- **When** I open a new "Import Recording" option in the app and pick that file
- **Then** it uploads and is processed through the exact same pipeline as a live recording (transcription, diarization, self-voice labeling), tagged with `source='imported'` so the UI can show it came from an external file rather than an in-app recording
- **Given** I instead use Android's share sheet from the call-recorder app or Files app
- **When** I share the audio file to ARO
- **Then** the app opens directly to the same import/upload flow (requires adding a `SEND`/`audio/*` intent-filter — not present today)
- **Given** an imported file is in a format the server doesn't currently accept (e.g. `.3gp`/`audio/3gpp`, `.amr`)
- **Then** the server's mime allowlist is extended to cover Samsung's call-recorder output formats, rather than silently rejecting or mislabeling them
- **Given** an imported recording did not go through the in-app consent screen
- **Then** the import flow shows its own consent confirmation step before upload (recording phone calls has its own legal consent requirements, same disclaimer as today's live-recording flow) — consent is not assumed just because the file already exists on-device

---

## Data Model Changes

### `schema.pg.ts` / `schema.ts`

**New table `voice_prints`:**

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | text, PK | | |
| `personId` | text, FK → `people.id` (cascade) | NOT NULL | Whose voice this is (Alpir has a `people` row too, or a dedicated self-reference — see Open Questions) |
| `embedding` | text (JSON-encoded float array) | NOT NULL | Stored as text for SQLite compatibility, same pattern as other JSON-ish columns in this schema |
| `sampleAudioPath` | text | NULL | Path to the enrollment sample, kept for re-enrollment/debugging |
| `model` | text | NOT NULL | Embedding model identifier + version, so old embeddings can be invalidated on model upgrade |
| `createdAt` / `updatedAt` | text | NOT NULL | |

**Extend `voice_recordings`:**

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `diarizationStatus` | text | NOT NULL | `'skipped'` | `skipped \| pending \| completed \| failed` |
| `diarizationError` | text | NULL | | |
| `source` | text | NOT NULL | `'live'` | `live \| imported` — distinguishes in-app recordings from imported call recordings |

**Extend `voice_recording_people`** (or new join table `voice_recording_speakers`): add `matchedAutomatically: integer (bool)` and `confidence: real` so the UI can distinguish "the system tagged this" from "I tagged this manually," matching the existing `confirmed` pattern used in `meeting-analysis.ts`'s participants array.

Mirror all of the above in `schema.ts` (SQLite) and add the corresponding bootstrap `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` blocks in `packages/database/src/index.ts`.

---

## Mobile (Android) Changes

### `apps/mobile/app.config.ts`

- expo-audio plugin: `enableBackgroundRecording: true`
- Android permissions: add `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, keep existing `RECORD_AUDIO`
- Android `foregroundServiceType: 'microphone'` declared for the service used by expo-audio's background mode
- No iOS changes in this spec (leave `UIBackgroundModes` unset)

### `apps/mobile/app/(tabs)/record.tsx`

- Remove the `AppState` listener that currently pauses recording on backgrounding (the "no background-recording permission" comment no longer applies)
- Recording state (elapsed time, status) must be derived from the actual recorder/service state on resume, not from component-local state that resets — verify this holds across fold/unfold configuration changes specifically (Z Fold 7 available for manual testing)
- Add a lightweight persistent-notification affordance if not automatically provided by expo-audio's background mode (check SDK behavior first; only build a custom notification if expo-audio doesn't surface one)

### Interruption handling

- Use expo-audio's interruption callbacks (or `AVAudioSession`/`AudioManager` focus-change events surfaced by the library) to pause/resume around phone calls and other apps grabbing the mic

### Import flow (new)

- New screen or entry point (e.g. a button on the existing recordings/meetings screen): "Import Recording" → `expo-document-picker` (new dependency, not currently installed) to pick an audio file from device storage
- Android share-target support: add an `intentFilters` block to `apps/mobile/app.config.ts`'s Android config for `action: SEND`, `data: { mimeType: 'audio/*' }`, so sharing from the call-recorder app or Files app lists ARO as a target — routes into the same import screen with the shared file URI pre-filled
- Import screen shows the same consent checkbox/disclaimer as the live-recording consent screen before uploading

---

## Web Changes

### `apps/web/src/app/voice/lib/use-recorder.ts`

- On recording start, call `navigator.wakeLock.request('screen')` inside a try/catch; store the sentinel and release it on stop or on `visibilitychange` if the page is being torn down
- Re-acquire the Wake Lock if the browser releases it automatically (e.g., tab regains visibility after having lost the lock) — listen for the sentinel's `release` event and re-request while still recording
- No change needed to the `MediaRecorder`/`ondataavailable` chunking logic itself — it already tolerates backgrounding

### UI

- Small inline note in the recording UI: "ההקלטה ממשיכה גם אם עוברים לטאב אחר. מצב שינה מלא של המחשב עדיין יעצור אותה."

---

## Backend Changes

### New service: `packages/api/src/services/voice-diarization.ts`

Responsible for: (1) running speaker diarization on the uploaded audio, (2) extracting an embedding per speaker segment, (3) comparing against stored `voice_prints`.

This cannot reuse Gemini's transcription call as-is, since Gemini's speaker labels are relative-per-recording text labels only, not portable embeddings. **Decision: self-hosted on the existing EC2 box** (no external speaker-ID API/vendor) — audio and voice data stay in-house, consistent with today's "no cloud storage, no third party beyond Gemini" posture.

Given the box is a 1GB free-tier instance, this needs a lightweight approach, not a full `pyannote-audio` pipeline:
- Use a small ONNX/CPU-friendly speaker-embedding model (diarization can be simplified since MVP only needs "is this segment me, yes/no" — a binary verification problem, not full multi-speaker clustering, which is a meaningfully lighter workload than general diarization)
- Run it as a small sidecar process (Python or Node, whichever has a workable lightweight embedding model available) alongside the existing Node app, invoked per-recording, not resident/always-on
- If the 1GB box genuinely can't handle even the lightweight version under real load, the fallback is a slightly larger EC2 instance for this one workload, not a third-party API — flagged as a risk to validate early (see Open Questions), not a blocker to drafting the spec

### `packages/api/src/services/voice.ts`

- After `transcribeWithGemini` succeeds, enqueue (or inline-call, consistent with today's fire-and-forget pattern in `processVoiceRecording`) the diarization step
- Merge diarization speaker-segment output with Gemini's transcript by timestamp/order, replacing "דובר N" labels with a matched person's name where confidence clears the threshold, leaving unmatched segments as "דובר לא מזוהה"
- Never block transcript/analysis availability on diarization completion — diarization result patches the transcript afterward if it finishes later

### New tRPC procedures (`packages/api/src/routers/voice.ts` or wherever voice procedures currently live)

- `voice.enrollVoicePrint({ audio })` — upload Alpir's reference sample, extract + store embedding (MVP: no `personId` param needed on the client side since there's only ever one enrollment; the router can resolve it to the current user's own `people` row)
- `voice.getVoicePrintStatus()` — whether self-enrollment exists yet, for the settings screen
- `voice.deleteVoicePrint()` — re-enrollment / reset

### Mime allowlist extension (for imported call recordings)

`EXT_BY_MIME` in `packages/api/src/services/voice.ts` currently omits `audio/3gpp` and `audio/amr` — add both so Samsung call-recorder output (`.3gp`/`.amr`) is accepted, alongside a `source` column (`'live' | 'imported'`) on `voice_recordings`.

---

## Storage & Retention

No change from current behavior: audio stays on local disk under the Docker persistent volume indefinitely, no auto-delete, no new expiry logic. Voiceprint embeddings and enrollment sample audio follow the same "kept indefinitely" policy as recordings.

---

## Out of Scope

1. iOS background recording (Android only, per user's device)
2. Auto-delete / retention policy changes (explicitly declined — keep current "retain forever" behavior)
3. Real-time (during-recording) transcription or diarization — diarization runs after upload, same timing as today's transcription
4. Cloud/S3 storage migration or external speaker-ID vendor — stays local/EC2-only, decided against a third-party API
5. Watch-mic routing (already out of scope from the prior spec; unaffected here)
6. **Automatic recognition of anyone besides Alpir** — explicitly descoped for this MVP; other participants continue to be tagged manually via the existing "attach person" flow. The schema stays general enough to add this later without a rewrite, but no per-contact enrollment UI is built now.
7. Importing recordings from sources other than local device files (e.g. no Google Drive/Dropbox picker, no direct carrier voicemail integration) — only on-device files via document-picker or Android share sheet

---

## Open Questions

1. **Match threshold:** what similarity score counts as "this is Alpir"? Needs a couple of real test recordings to tune; should probably be a tunable constant, not hardcoded from day one.
2. **Lightweight embedding model choice:** which specific small ONNX/CPU speaker-embedding model to use, validated for acceptable latency and memory footprint on the actual 1GB EC2 instance — needs a quick spike before full implementation to confirm the box can handle it at all (this is the main technical risk in the spec; if it can't, the fallback is a slightly larger instance for this one job, not a third-party API per the decision above).
3. **Re-enrollment:** if the embedding model is upgraded later, the stored `voice_prints` row needs a migration/re-enrollment path (the `model` column is meant to support detecting staleness, but the re-enrollment UX itself isn't designed yet).
4. **Foreground-service notification content in Hebrew** — exact copy needs a pass (this draft uses placeholder text).
5. **Imported-file duration floor** — today's live-recording flow enforces a 10s minimum; should imported call recordings have the same floor, or none (a very short call is still a legitimate call)?

---

## Testing Notes

- Manual QA on the actual Z Fold 7: start recording unfolded, fold mid-recording, unfold again, verify no audio gap and correct elapsed-time display; repeat starting folded.
- Manual QA: start recording, lock screen for 5+ minutes, unlock, verify continuous audio.
- Manual QA: incoming call during recording — verify pause/resume behavior.
- Web: start recording, switch tabs for several minutes, switch back, verify continuous audio; test in at least Chrome (Wake Lock supported) and one browser without Wake Lock support to confirm graceful fallback.
- Speaker ID: enroll voice, record a conversation with at least one other speaker, verify correct self-labeling; verify fallback behavior (Gemini-only relative labels) when diarization service is unreachable/erroring.
- Import flow: use a real Samsung call-recorder `.3gp` file (or `.m4a` if that's the device's actual output format — verify which on the Z Fold 7 before assuming `.3gp`), import via document-picker, verify upload/transcription/labeling succeeds; test the Android share-sheet path end-to-end from the call-recorder app.
- Vitest: `voice-diarization.test.ts` — mock the diarization/embedding call, test threshold matching logic, test merge-with-transcript logic, test fallback-on-error path.
- Vitest: mime-allowlist test confirming `.3gp`/`audio/3gpp` uploads are now accepted.
