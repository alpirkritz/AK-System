# Recording Context Before Upload

> **Slug:** `recording-context-before-upload`
> **Status:** Draft
> **Last Updated:** 2026-10-13

## Goal

Before any voice recording (live or imported) is sent to the server for transcription, the user sees a
brief **context confirmation** step where they can set or verify the project and attendees for that
conversation. The confirmed context is passed to Gemini's analysis prompt, enabling more accurate
participant attribution, action-item ownership, and topic summarisation. Meeting titles that were
created as placeholders by the recording pipeline are then automatically renamed from the AI-generated
`analysis.topic` field.

## User Stories

- As a user recording a free conversation, I want to confirm (or add) attendees and a project
  **before** the file uploads, so that Gemini has the right people context from the start.
- As a user recording a calendar meeting, I want to review the pre-populated attendees/project before
  upload, so that I can remove people who weren't actually there.
- As a user importing an external recording, I want the same confirmation step, so that imported files
  also get proper context.
- As a user, I want the meeting name to reflect what the conversation was actually about rather than
  the generic placeholder "שיחה מוקלטת".

## Acceptance Criteria

- [ ] On web: pressing "עצור" stops the recorder but does **not** upload; a review panel appears
      with pre-populated people/project (from meeting or free-recording picker) and an
      **"העלה שיחה"** primary button.
- [ ] On web: a "ביטול" link in the review panel discards the captured audio and returns to idle.
- [ ] On mobile live recording: pressing "עצור ושלח" transitions to a `'review'` phase with
      `RecordingContextEditor` pre-populated; "העלה שיחה" triggers the actual upload.
- [ ] On mobile import: after file pick + consent the phase becomes `'review'`; same editor and
      upload button appear before any upload begins.
- [ ] For calendar-meeting recordings (web + mobile), the review pre-populates people from
      `meeting.people` and project from `meeting.projectId`; the user can remove people who weren't present.
- [ ] The confirmed `personIds` (even if empty) and `projectId` are sent to the server at upload time.
- [ ] `analyzeTranscript` receives `knownPeople` (name, role, company) and `projectName` as
      optional context fields; `buildAnalysisPrompt` includes them in the Gemini prompt.
- [ ] After `processVoiceRecording` saves the analysis, if the linked meeting was created by the
      recording pipeline (`createdMeetingId === meetingId`) and the current title starts with
      `שיחה מוקלטת`, `meetings.title` is updated to `analysis.topic` (max 120 chars, trimmed).
- [ ] Titles of calendar-synced meetings and meetings whose title has been manually edited are
      **never** changed.
- [ ] Old API clients (web/mobile before this change) that send no `personIds` at all continue to
      work; the gate is purely in the client UI, not in server validation.
- [ ] All existing Vitest and Playwright tests remain green.

## Data Model

No schema changes required. The existing fields are sufficient:

| Table | Field | Usage |
|---|---|---|
| `voice_recordings` | `project_id` | set at upload from confirmed context |
| `voice_recording_people` | `(recording_id, person_id)` | set at upload from confirmed context |
| `meetings` | `title` | updated post-analysis for voice-placeholder meetings only |
| `meeting_analyses` | `topic` | source for the new meeting title |
| `people` | `role`, `company` | loaded for `knownPeople` context passed to Gemini |
| `projects` | `name` | loaded for `projectName` context passed to Gemini |

Both `schema.pg.ts` and `schema.ts` are unchanged.

## tRPC API

No new procedures. The existing upload flow is used:

- `POST /api/voice/upload` already accepts `personIds`, `projectId`, `meetingId`, `source`.
  No server-side validation change; missing fields continue to be tolerated for back-compat.

### `AnalyzeTranscriptOptions` extension (`packages/api/src/services/meeting-analysis.ts`)

```ts
export interface AnalyzeTranscriptOptions {
  transcriptText: string
  meetingTitle: string
  meetingDate: string
  participantNames?: string[]         // existing
  projectName?: string                // NEW — project context for Gemini
  knownPeople?: {                     // NEW — CRM profiles for Gemini
    name: string
    role?: string
    company?: string
  }[]
}
```

`buildAnalysisPrompt` adds a "CONTEXT" block before the transcript when these fields are present.

### `processVoiceRecording` additions (`packages/api/src/services/voice.ts`)

- After resolving `meeting_people` names, also query `people.role`, `people.company` and
  `projects.name` for the confirmed people/project.
- Pass them to `analyzeTranscript({ ..., projectName, knownPeople })`.
- After `db.update(meetingAnalyses ...)` succeeds, check:
  ```
  if createdMeetingId === meetingId AND meeting.title starts with 'שיחה מוקלטת'
    → db.update(meetings).set({ title: result.topic.slice(0, 120).trim() })
  ```

## UI Surface

### Web — `apps/web/src/app/voice/page.tsx`

New state:
```ts
const [pendingBlob, setPendingBlob] = useState<{
  blob: Blob; durationSeconds: number; meetingId: string | null
} | null>(null)
// reviewPeople / reviewProject mirror people/project but are initialised
// from the meeting context when entering review from a meeting recording.
const [reviewPeople, setReviewPeople] = useState<PersonOption[]>([])
const [reviewProject, setReviewProject] = useState<string>('')
```

Flow change:
- `stopAndUpload` → stop recorder → validate duration → set `pendingBlob`, initialise `reviewPeople`/`reviewProject` from current `people`/`projectId` (or `meeting.people`/`meeting.projectId`) → show review panel instead of uploading.
- Review panel (shown when `pendingBlob && !upload`) renders:
  - `PeoplePicker` + project `<select>` pre-populated
  - `<button>` "העלה שיחה" calls `doUpload(pendingBlob.blob, durationSeconds, meetingId)` with the reviewed context set on `people`/`projectId` state
  - `<button>` "ביטול" clears `pendingBlob` + resets recorder state
- `failedUpload` retry path unchanged (already has stored context).

### Mobile — `apps/mobile/app/(tabs)/record.tsx`

```ts
type Phase = 'consent' | 'recording' | 'paused' | 'review' | 'uploading' | 'result'
```

New state:
```ts
const [pendingUri, setPendingUri] = useState<string | null>(null)
const [pendingDuration, setPendingDuration] = useState(0)
```

`stopAndUpload` renamed/split:
- `stopRecording()`: stop recorder → validate → set `pendingUri`/`pendingDuration` → for meeting recordings seed `people` from `meeting.people` + `project` from `meeting.projectId` → `setPhase('review')`.
- `confirmUpload()`: reads current `people`/`project`/`meeting` + `pendingUri`/`pendingDuration` → calls `uploadVoiceRecording` → transitions `uploading` → `result`.

`beforeRemove` guard: add `'review'` to blocked phases.

Review phase UI (new card between `active` block and `uploading` block):
```
<View style={styles.card}>
  <Text style={styles.sectionLabel}>אישור לפני העלאה</Text>
  <RecordingContextEditor ... />
  <Pressable onPress={confirmUpload} ...>העלה שיחה</Pressable>
  <Pressable onPress={discardReview} ...>ביטול</Pressable>
</View>
```

`discardReview()` deletes `pendingUri` file, resets state, `setPhase('consent')`.

`PendingUpload` for failed uploads now always stores confirmed context (same as today — no change to the type shape, but `personIds` are now always the reviewed list, not `[]` for meeting recordings).

### Mobile — `apps/mobile/app/(tabs)/import-recording.tsx`

```ts
type Phase = 'pick' | 'ready' | 'review' | 'uploading' | 'done'
```

After consent checked in `'ready'`, pressing "המשך לבחירת הקשר" → `setPhase('review')`.
`'review'` renders `RecordingContextEditor` (needs a local `directory` load via `fetchPeople`/`fetchProjects`).
"העלה שיחה" triggers the existing `upload()` with the collected `personIds`/`projectId`.
"ביטול" resets to `'ready'`.

## Out of Scope

- Exact speaker → person matching (remains in the existing diarization/speaker-ID flow).
- Updating titles of calendar-synced or Notion meetings.
- Re-running `analyzeTranscript` when people are added post-upload via `voice.attachToPeople`.
- Updating Notion transcript analysis paths (Notion sync is separate).
- Web file-import screen (does not exist yet; mobile import is covered here).

## Open Questions

- None — decisions confirmed in product planning session 2026-10-13.
