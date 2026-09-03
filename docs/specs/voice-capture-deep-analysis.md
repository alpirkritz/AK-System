# Voice Capture and Deep Analysis from Mobile

**Stack:** `next-trpc-monorepo` (backend) + `expo` (mobile)  
**Slug:** `voice-capture-deep-analysis`  
**Status:** Draft  
**Created:** 2026-09-03  
**Dependency:** Requires `meeting-transcript-deep-analysis` implemented first

---

## Goal

Enable users to record conversations directly from the mobile app, transcribe them via Gemini audio API, and analyze them using the same deep analysis pipeline from Spec 1 — providing the full experience (mood, subtext, kaizen, action items) for meetings not recorded in Notion.

---

## User Stories

1. **As a user**, I want to record a spontaneous meeting or conversation from my phone so that I can capture discussions that happen outside my scheduled calendar.

2. **As a user**, I want to see a clear consent prompt before recording starts so that I'm reminded to inform participants and comply with recording laws.

3. **As a user**, I want the recording to be transcribed automatically after it ends so that I don't have to manually type notes.

4. **As a user**, I want the same rich analysis (mood, subtext, kaizen, action items) applied to my phone recordings as I get from Notion transcripts so that I have a consistent experience.

5. **As a user**, I want to optionally route audio input to my Garmin Venu 3's microphone when recording so that the watch can serve as a hands-free recording device during walks or workouts (understanding quality trade-offs).

6. **As a user**, I want to link the recording to an existing meeting or create a new meeting record so that the analysis appears in the meetings UI alongside Notion-sourced meetings.

7. **As a user**, I want control over whether the audio file is kept or deleted after transcription so that I can manage storage and privacy.

---

## Acceptance Criteria

### Recording UI (Mobile)
- **Given** I'm on the mobile meetings screen
- **When** I tap a "Record Conversation" FAB or toolbar button
- **Then** I see a consent screen with checkbox: "All participants have consented to recording" and legal disclaimer

### Recording Flow
- **Given** I've confirmed consent
- **When** I start recording
- **Then** the app displays: elapsed time, waveform visualization, pause/resume button, and stop button

### Audio Routing (Default)
- **Given** I start a recording without changing settings
- **When** recording is active
- **Then** audio is captured from the phone's built-in microphone at full quality (m4a mono, 44.1kHz)

### Audio Routing (Optional: Watch Mic)
- **Given** I enable "Use watch microphone" in recording settings AND my Garmin Venu 3 is connected via Bluetooth
- **When** I start recording
- **Then** audio input is routed to the watch's microphone (with quality downgrade warning: narrowband 8-16kHz due to Bluetooth HFP/HSP profile)

### Upload
- **Given** I stop a recording
- **When** the recording is longer than 10 seconds
- **Then** the app uploads the audio file to the server via multipart HTTP (not tRPC base64), showing progress

### Transcription
- **Given** the server receives an audio file
- **When** file size < 20MB
- **Then** transcription uses Gemini's `inlineData` API
- **When** file size >= 20MB
- **Then** transcription uses Gemini's Files API (upload → process → delete)

### Analysis Pipeline
- **Given** transcription completes successfully
- **When** the transcript text is available
- **Then** the system calls the same `analyzeTranscript` service from Spec 1 with `source='recording'`

### Meeting Linking
- **Given** I start a recording from the meeting detail screen (`/meeting/[id]`)
- **When** upload completes
- **Then** the analysis is linked to that meeting
- **Given** I start a recording from the main meetings list or recordings tab
- **When** upload completes
- **Then** a new meeting record is created with title "[Recording] YYYY-MM-DD HH:MM"

### Audio Retention
- **Given** an analysis with `source='recording'`
- **When** I view the analysis in the app
- **Then** I see options: "Keep Audio" (default, grayed out if already kept) or "Delete Audio" (with confirmation)
- **Given** a user setting `autoDeleteRecordingsAfterTranscription=true`
- **When** transcription completes
- **Then** the audio file is deleted from disk automatically

### Error Handling
- **Given** transcription fails (Gemini error, unsupported format, etc.)
- **When** I view the recording's status
- **Then** I see error message and "Retry" button (re-uploads same file)

---

## Garmin Venu 3 Limitations (Critical Context)

**Research findings (September 2026):**

1. **No Connect IQ Microphone API**
   - Garmin's Connect IQ SDK does not expose microphone access to third-party developers
   - Feature request open since February 2023 with no official response or roadmap
   - This means: **no standalone watch app can record audio**

2. **No Native Voice Memo on Venu 3**
   - Fenix 8 has built-in voice memo feature; Venu 3 does not
   - Therefore: **no Garmin Connect sync path for recordings**

3. **Watch Mic Functions as Bluetooth Headset Only**
   - The Venu 3's microphone works exclusively for phone calls and triggering phone voice assistants
   - It operates as a Bluetooth hands-free profile (HFP) or headset profile (HSP) device

### Implication for This Spec

**Watch-mic recording is possible BUT with constraints:**
- The phone app must initiate and control recording (not the watch)
- Audio routing uses the same Bluetooth HFP/HSP channel as phone calls
- Quality is degraded to narrowband (8-16kHz, mono, compressed) — this is a Bluetooth protocol limitation, not a Garmin limitation
- Requires native modules on both iOS and Android (not available in vanilla Expo)
- Requires `expo-dev-client` build (cannot use Expo Go)

**Recommendation:** Implement watch-mic routing as **Phase 2b (optional)** with a clear UI warning about quality trade-offs. Default to phone mic for Phase 1.

---

## Data Model Changes

### Extension to `meeting_analyses` (from Spec 1)

No schema changes required — `source` column already supports `'recording'`.

### New Column in `meeting_analyses`: `audioPath`

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `audioPath` | text | NULL | — | Absolute path to audio file on disk (if retained) |

**Location:** Same table as Spec 1 (`meeting_analyses`). Add via SQLite bootstrap `ALTER TABLE` in `packages/database/src/index.ts`.

### New Column in `user_settings`: `autoDeleteRecordingsAfterTranscription`

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `autoDeleteRecordingsAfterTranscription` | integer | NOT NULL | 0 | SQLite boolean (0 = keep, 1 = auto-delete) |

---

## Mobile App Changes

### File: `apps/mobile/app.config.ts` (or `app.json`)

Add microphone permissions:

```typescript
{
  plugins: [
    // ... existing plugins ...
    [
      'expo-av',
      {
        microphonePermission: 'Allow ARO to record conversations for analysis.'
      }
    ]
  ],
  ios: {
    infoPlist: {
      NSMicrophoneUsageDescription: 'ARO records conversations to provide meeting analysis and transcription.'
    }
  },
  android: {
    permissions: ['RECORD_AUDIO']
  }
}
```

**Note:** `expo-av` is the standard Expo audio library. For watch-mic routing (Phase 2b), a custom native module is required.

### New Dependency: `expo-av`

```bash
pnpm --filter @ak-system/mobile add expo-av
```

### New Screen: `apps/mobile/app/recordings.tsx`

**Tab icon:** 🎙️ (microphone)  
**Tab label:** "הקלטות"

**UI:**
- List of recordings (newest first), grouped by status:
  - "בתהליך תמלול" (transcribing)
  - "הושלם" (completed)
  - "נכשל" (failed)
- Each item shows: title/timestamp, duration, status badge, thumbnail waveform (if available)
- Tapping opens recording detail screen

**tRPC calls:**
- `meetings.listAnalyses({ source: 'recording' })` — new query (see tRPC section)

### New Screen: `apps/mobile/app/recording/record.tsx`

**Navigated from:**
- FAB on meetings list
- "Record" button on meeting detail page (passes `meetingId` as param)

**UI Phases:**

#### Phase 1: Consent
- Checkbox: "כל המשתתפים הסכימו להקלטה"
- Legal disclaimer text: "Recording conversations without consent may be illegal in your jurisdiction. You are responsible for compliance with local laws."
- "Start Recording" button (disabled until checkbox checked)

#### Phase 2: Recording
- Large elapsed time display (MM:SS)
- Waveform visualization (using `expo-av`'s audio level monitoring)
- Pause/Resume button (optional — can be deferred to Phase 1.5)
- Stop button (red, prominent)
- Small label: "Recording with [phone mic | watch mic]" based on setting

#### Phase 3: Upload
- Progress bar (0-100%)
- "Uploading..." text
- Cancel button (stops upload, discards recording)

#### Phase 4: Processing
- Spinner + "Transcribing..."
- Estimated time remaining (if available)
- "View in background" button (navigates back, lets processing continue)

**State management:** Use React Query mutation for upload; poll analysis status via `meetings.getAnalysis`.

### New Settings Section: `apps/mobile/app/settings/recording.tsx`

**Location:** Add to existing settings screen or new "Recording" settings tab

**Controls:**
1. **Auto-delete audio after transcription** (toggle, default OFF)
   - Help text: "Audio files are deleted automatically once transcription completes. Transcript and analysis are kept."

2. **[Phase 2b] Use watch microphone** (toggle, default OFF, only visible if Garmin connected)
   - Help text: "Route audio input to your Garmin Venu 3. Quality is reduced to 8-16kHz narrowband due to Bluetooth limitations."
   - Warning badge: "⚠️ Lower Quality"

### Recording Service: `apps/mobile/lib/recording.ts`

**Exports:**

```typescript
export async function startRecording(options: {
  useWatchMic?: boolean
}): Promise<Recording>

export async function stopRecording(
  recording: Recording
): Promise<{ uri: string; durationMs: number }>

export async function uploadRecording(options: {
  uri: string
  meetingId?: string
  onProgress: (percent: number) => void
}): Promise<{ analysisId: string }>
```

**Implementation notes:**
- Default: `expo-av`'s `Audio.Recording` with `RECORDING_OPTIONS_PRESET_HIGH_QUALITY`
- Watch mic (Phase 2b): custom native module to set audio session category (iOS) or start Bluetooth SCO (Android) before recording
- Upload: `fetch` with `FormData` to `/api/recordings/upload` (new route, see backend section)

---

## Backend Changes

### New HTTP Route: `apps/web/src/app/api/recordings/upload/route.ts`

**Method:** `POST`  
**Auth:** Bearer token (mobile JWT) or dev session  
**Content-Type:** `multipart/form-data`

**Fields:**
- `audio` (file, required) — m4a, mp3, wav, or webm
- `meetingId` (string, optional) — link to existing meeting
- `duration` (number, optional) — duration in ms

**Logic:**
1. Validate auth + file type (reject if not audio/*)
2. Generate file ID: `rec_` + `Date.now()` + random(5)
3. Save to disk: `${RECORDINGS_DIR}/${fileId}.${ext}` (e.g., `/data/recordings/rec_1725348000_a1b2c.m4a`)
4. Create `meeting_analyses` row:
   - `source='recording'`
   - `status='pending'`
   - `audioPath=<full path>`
   - `meetingId=<provided or null>`
   - `transcriptText=null` (filled later)
5. Trigger background transcription job (see next section)
6. Return `{ analysisId: string }`

**File storage:**
- Env var: `RECORDINGS_DIR` (default: `${process.cwd()}/data/recordings`)
- Create directory if missing
- Pattern mirrors `EXPENSES_DIR` from `expense-folders.ts` — local filesystem, no S3

### New Service: `packages/api/src/services/recording-transcription.ts`

**Export:** `transcribeRecording`

```typescript
export async function transcribeRecording(
  audioPath: string,
  mimeType: string
): Promise<{ transcriptText: string }>
```

**Logic:**
1. Read file from disk → base64 buffer
2. Check file size:
   - **< 20MB:** Use Gemini `inlineData` API (same pattern as `invoice-ocr.ts`)
   - **>= 20MB:** Use Gemini Files API:
     - Upload file → get `fileUri`
     - Call `generateContent` with `fileUri`
     - Delete file via Files API
3. Prompt: "Transcribe the following audio conversation verbatim. Preserve speaker labels if identifiable. Output as plain text."
4. Return transcript

**Error handling:** Throw descriptive errors; caller stores in `meeting_analyses.error`.

### Background Transcription Job

**Option A (recommended for MVP):** Inline after upload — call `transcribeRecording` synchronously in the upload route, return analysisId immediately. Mobile polls for status.

**Option B (better UX, requires queue):** Enqueue a job (e.g., via a simple in-memory queue or external tool like BullMQ) that:
1. Calls `transcribeRecording`
2. Updates `meeting_analyses.transcriptText`
3. Calls `analyzeTranscript` service (from Spec 1)
4. Updates analysis fields
5. Optionally: call `pushAssistantMessage` to notify user (if enabled for `meeting_analysis`)

**Recommendation:** Start with Option A; refactor to Option B if upload-time latency becomes an issue (hour-long recordings may take 30-60 seconds to transcribe).

### New tRPC Query: `meetings.listAnalyses`

**Router:** `packages/api/src/routers/meetings.ts`

```typescript
listAnalyses: protectedProcedure
  .input(
    z.object({
      source: z.enum(['notion_transcript', 'recording']).optional(),
      limit: z.number().min(1).max(100).default(50)
    })
  )
  .query(async ({ input, ctx }) => {
    // SELECT from meeting_analyses
    // WHERE source = input.source (if provided)
    // ORDER BY createdAt DESC
    // LIMIT input.limit
    // JOIN meetings for title
    // Return array of { id, meetingId, meetingTitle, status, createdAt, duration?, error? }
  })
```

### Audio Deletion Endpoint: `meetings.deleteRecordingAudio`

```typescript
deleteRecordingAudio: protectedProcedure
  .input(z.object({ analysisId: z.string().min(1) }))
  .mutation(async ({ input, ctx }) => {
    // Fetch analysis row
    // If audioPath exists, delete file from disk
    // Set audioPath = null
    // Return success
  })
```

---

## Gemini Audio API Integration

### Model Support

- **Gemini 2.5 Flash** (and later) supports audio input natively
- Mime types: `audio/mp3`, `audio/mp4` (m4a), `audio/wav`, `audio/webm`
- Max file size via `inlineData`: ~20MB (unofficial limit; use Files API above this)

### Code Pattern (Small Files)

```typescript
const model = genAI.getGenerativeModel(getGeminiModelOptions())
const audioBase64 = fs.readFileSync(audioPath, 'base64')

const result = await model.generateContent([
  { text: 'Transcribe this audio conversation verbatim.' },
  {
    inlineData: {
      mimeType: 'audio/mp4', // or detected from file extension
      data: audioBase64
    }
  }
])

const transcriptText = result.response.text()
```

### Code Pattern (Large Files)

```typescript
import { GoogleAIFileManager } from '@google/generative-ai/server'

const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!)

// Upload
const uploadResult = await fileManager.uploadFile(audioPath, {
  mimeType: 'audio/mp4',
  displayName: 'recording.m4a'
})

const fileUri = uploadResult.file.uri

// Transcribe
const model = genAI.getGenerativeModel(getGeminiModelOptions())
const result = await model.generateContent([
  { text: 'Transcribe this audio conversation verbatim.' },
  { fileData: { fileUri, mimeType: 'audio/mp4' } }
])

const transcriptText = result.response.text()

// Clean up
await fileManager.deleteFile(uploadResult.file.name)
```

**Reference:** Gemini API docs at `ai.google.dev/gemini-api/docs/audio` (2026 version)

---

## Phase 2b: Watch Microphone Routing (Optional)

**Decision gate:** Only implement if user feedback strongly demands it AND team has capacity for native module development.

### iOS Implementation

**Native module:** `apps/mobile/modules/audio-session/ios/AudioSessionModule.swift`

```swift
import AVFoundation

@objc(AudioSessionModule)
class AudioSessionModule: NSObject {
  @objc
  func setBluetoothInput() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playAndRecord, options: [.allowBluetooth])
    try? session.setActive(true)
    
    // Enumerate inputs, select Bluetooth
    if let inputs = session.availableInputs {
      for input in inputs where input.portType == .bluetoothHFP {
        try? session.setPreferredInput(input)
        break
      }
    }
  }
  
  @objc
  func resetAudioSession() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback)
    try? session.setActive(false)
  }
}
```

### Android Implementation

**Native module:** `apps/mobile/modules/audio-session/android/AudioSessionModule.kt`

```kotlin
import android.media.AudioManager
import android.content.Context

class AudioSessionModule(reactContext: ReactApplicationContext) : 
  ReactContextBaseJavaModule(reactContext) {
  
  override fun getName() = "AudioSessionModule"
  
  @ReactMethod
  fun setBluetoothInput() {
    val audioManager = reactApplicationContext
      .getSystemService(Context.AUDIO_SERVICE) as AudioManager
    
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    audioManager.startBluetoothSco()
    audioManager.isBluetoothScoOn = true
  }
  
  @ReactMethod
  fun resetAudioSession() {
    val audioManager = reactApplicationContext
      .getSystemService(Context.AUDIO_SERVICE) as AudioManager
    
    audioManager.stopBluetoothSco()
    audioManager.isBluetoothScoOn = false
    audioManager.mode = AudioManager.MODE_NORMAL
  }
}
```

### Usage in Recording Service

```typescript
import AudioSessionModule from './modules/audio-session'

export async function startRecording(options: { useWatchMic?: boolean }) {
  if (options.useWatchMic) {
    await AudioSessionModule.setBluetoothInput()
  }
  
  const recording = new Audio.Recording()
  await recording.prepareToRecordAsync(
    options.useWatchMic 
      ? RECORDING_OPTIONS_NARROWBAND  // 16kHz, mono
      : RECORDING_OPTIONS_PRESET_HIGH_QUALITY
  )
  await recording.startAsync()
  
  return recording
}

export async function stopRecording(recording: Recording) {
  await recording.stopAndUnloadAsync()
  await AudioSessionModule.resetAudioSession()
  
  return { uri: recording.getURI(), durationMs: recording._finalDurationMillis }
}
```

**Quality constants:**
```typescript
const RECORDING_OPTIONS_NARROWBAND = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
    audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000
  },
  ios: {
    extension: '.m4a',
    audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_MIN,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false
  }
}
```

**Build requirement:**
```bash
pnpm --filter @ak-system/mobile run prebuild
eas build --profile development --platform ios
eas build --profile development --platform android
```

Not compatible with Expo Go.

---

## Privacy & Compliance (CRITICAL)

Per `C_Core/brand_dna_and_compliance.md`:

### Recording Consent

**Legal context:** Recording laws vary by jurisdiction:
- **One-party consent** (e.g., USA - varies by state): Only the recorder must consent
- **Two-party/all-party consent** (e.g., California, Canada, EU): ALL participants must consent before recording

**Implementation:**
1. **Consent screen** (mandatory, cannot be skipped):
   - Checkbox: "I confirm that all participants have consented to this recording."
   - Text: "Recording without consent may violate privacy laws in your jurisdiction. By proceeding, you accept full legal responsibility for compliance."
   - Link: "Learn about recording laws" → external resource (e.g., GDPR info page)

2. **Consent log**:
   - Store consent timestamp in `meeting_analyses.consentConfirmedAt` (new column)
   - Never allow recording to start without checked consent

3. **Participant notification** (recommended but not enforced by app):
   - UI reminder after consent: "Remember to verbally inform all participants before starting."

### Data Retention

**Default policy:**
- Audio files: Retained until user explicitly deletes OR auto-delete setting is enabled
- Transcripts: Retained as long as meeting record exists
- Analysis: Retained as long as meeting record exists

**User controls:**
1. Per-recording deletion: "Delete Audio" button in analysis view
2. Bulk deletion: Settings option "Delete all audio files older than [30/60/90 days]" (future enhancement)
3. Auto-delete after transcription: `autoDeleteRecordingsAfterTranscription` setting

**Cascade deletion:**
- Deleting a meeting → cascades to delete its analysis (including audio file via trigger or application logic)

### PII Handling

- Transcripts contain potentially sensitive conversation content
- No external sharing — all processing happens within user's AK System instance
- Access control: Only the user who created the recording can view its analysis
- No telemetry or analytics sent to external services (Gemini receives audio/transcript but doesn't store it per Google AI API terms)

### Disclaimers

**In-app (recording detail page footer):**
> "This transcript and analysis were generated by AI and may contain errors. Do not rely on it for legal, medical, HR, or other critical decisions without human review."

**In-app (consent screen):**
> "You are solely responsible for ensuring compliance with applicable recording laws. AK System does not provide legal advice."

### Compliance Checklist (Pre-Implementation)

- [ ] Consent screen implemented with mandatory checkbox
- [ ] Consent timestamp logged in database
- [ ] Audio file deletion capability implemented
- [ ] Auto-delete setting implemented
- [ ] Cascade deletion on meeting removal implemented
- [ ] Legal disclaimer displayed on recording screens
- [ ] No PII is transmitted to external services beyond Gemini (which processes but doesn't retain)
- [ ] User documentation includes recording law guidance

---

## Out of Scope

1. **Watch app for recording** — technically impossible with current Garmin Connect IQ SDK (see Garmin Limitations section)
2. **Sync from Garmin Fenix 8 voice memos** — different device, different workflow; defer to separate spec if demand exists
3. **Real-time transcription during recording** — transcription happens after recording ends
4. **Speaker identification beyond Notion's transcript format** — relies on Gemini's transcription output; no custom diarization
5. **Editing transcripts in-app** — transcripts are read-only; re-record if changes needed
6. **Background recording while app is closed** — recording stops if user navigates away or locks phone (standard mobile behavior for privacy/battery)
7. **Sharing recordings with other users** — recordings are private to the user's account
8. **Cloud backup of audio files** — files stored locally on server disk only (no S3 in current system)

---

## Open Questions

1. **Maximum recording length:** Should we enforce a cap (e.g., 2 hours) to prevent storage/transcription issues? (Recommendation: 2-hour soft cap with warning, 3-hour hard stop)

2. **Recording mid-meeting:** If user starts recording 20 minutes into a meeting, should the created meeting record's start time reflect recording start or inferred meeting start? (Recommendation: recording start, user can manually adjust)

3. **Gemini rate limits:** What happens if user submits 10 hour-long recordings in quick succession? (Recommendation: queue system with max 3 concurrent transcriptions, show "Queued" status in UI)

4. **Watch mic quality vs. phone mic:** Should we A/B test transcription accuracy to validate the quality degradation claim? (Recommendation: yes, manual QA with 3-5 sample recordings before launch)

5. **Consent for group chats:** If recording is linked to a meeting with 5+ external participants, should we require explicit per-person consent tracking? (Recommendation: out of scope for MVP; add to future "enterprise compliance" feature set)

6. **Bluetooth disconnection mid-recording:** If watch mic is selected but watch disconnects, should recording continue with phone mic or stop? (Recommendation: continue with phone mic, log warning in analysis metadata)

---

## Testing Notes

### Unit Tests (Vitest)

**File:** `packages/api/src/services/recording-transcription.test.ts`

- Mock Gemini API with fixture audio base64
- Test small file path (inlineData)
- Test large file path (Files API) with mock upload/delete
- Test error handling (unsupported format, API timeout)

### Integration Tests (Playwright)

Not applicable — mobile recording requires physical device/emulator with microphone hardware. Manual QA only.

### Manual QA Checklist

**Phase 1 (Phone Mic):**
1. [ ] Start recording, speak 30 seconds, stop → verify upload progress
2. [ ] Check transcription accuracy (Hebrew + English mixed)
3. [ ] Verify analysis displays in `/meetings/[id]` with all fields
4. [ ] Create task from action item
5. [ ] Delete audio, verify file removed from server
6. [ ] Enable auto-delete setting, record new conversation, verify audio deleted after transcription

**Phase 2b (Watch Mic, if implemented):**
1. [ ] Pair Garmin Venu 3 via Bluetooth
2. [ ] Enable "Use watch microphone" setting
3. [ ] Start recording, verify input routed to watch (speak near watch, not phone)
4. [ ] Compare transcription quality to phone-mic recording
5. [ ] Disconnect watch mid-recording, verify fallback to phone mic

**Privacy/Consent:**
1. [ ] Attempt to start recording without checking consent → verify blocked
2. [ ] Check consent, start recording → verify `consentConfirmedAt` logged in DB

---

## Implementation Order (Recommendation)

### Phase 1: Core Recording (Phone Mic Only)

1. **Mobile permissions + UI** — consent screen, recording screen, upload progress
2. **Backend upload route** — `/api/recordings/upload`, file storage to disk
3. **Transcription service** — `recording-transcription.ts`, Gemini audio integration (small files first)
4. **Analysis integration** — link to Spec 1's `analyzeTranscript` pipeline
5. **Mobile recordings list** — new tab, display analyses with `source='recording'`
6. **Audio deletion** — UI control + `deleteRecordingAudio` endpoint
7. **Settings** — auto-delete toggle, save to `user_settings`
8. **Manual QA** — test on real device with 3-5 sample conversations

### Phase 2a: Large Files

- Gemini Files API integration for recordings > 20MB

### Phase 2b: Watch Mic Routing (Optional)

- User research: survey users on interest + acceptable quality trade-off
- Native module development (iOS + Android)
- Dev build setup for testing
- QA comparison: phone vs. watch mic transcription accuracy

**Decision point:** If <20% of users request watch-mic feature in surveys, defer indefinitely.

---

## Migration Notes

**No database migration needed** beyond:
1. Add `audioPath` column to `meeting_analyses` (SQLite bootstrap ALTER)
2. Add `consentConfirmedAt` column to `meeting_analyses` (SQLite bootstrap ALTER)
3. Add `autoDeleteRecordingsAfterTranscription` column to `user_settings` (or create column if table doesn't exist)

All changes are additive; existing Notion-based analyses unaffected.

---

## Cost Estimate (Gemini API)

**Gemini 2.5 Flash pricing (as of Sept 2026):**
- Audio input: ~$0.00001875 per second (~$0.04 per hour)
- Text generation: ~$0.000075 per 1K tokens output

**Per hour-long recording:**
- Transcription: ~$0.04
- Analysis (assuming 500-token output): ~$0.04
- **Total: ~$0.08 per hour-long recording**

For 100 recordings/month: ~$8/month incremental cost (negligible).

---

## Success Metrics

1. **Adoption:** % of users who record at least 1 conversation in first 30 days after launch
2. **Retention:** % of recordings that result in completed analyses (vs. failed transcriptions)
3. **Task conversion:** % of action items that are converted to tasks
4. **Audio retention:** % of users who enable auto-delete vs. keep audio files
5. **Watch mic usage (Phase 2b):** % of recordings using watch mic (if feature shipped)

**Target (MVP):** >30% adoption, >90% transcription success rate, >50% task conversion rate.
