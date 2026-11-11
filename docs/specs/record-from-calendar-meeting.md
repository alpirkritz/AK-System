# Record From a Calendar Meeting

**Stack:** `next-trpc-monorepo` (backend + web) + `expo` (mobile)
**Slug:** `record-from-calendar-meeting`
**Status:** Draft
**Created:** 2026-10-05
**Relates to:** `recording-auto-calendar-context` (post-upload automatic guess — stays as the fallback when nothing was chosen), `recording-background-and-speaker-id`, `voice-upload-retry-without-rerecording`

---

## Goal

Make the recording screen open on a list of today's calendar meetings, so one tap starts recording a specific meeting and the recording carries that meeting's title, participants, project and time with no manual typing. Free recording with no meeting stays available as a row in the same list.

---

## User stories

1. As Alpir, I want the recording screen to list today's meetings so one tap on a meeting starts recording it, with the title and participants taken from the calendar.
2. As Alpir, I want a "record this meeting" button on a meeting card or detail page (web and mobile), so I can start from the meeting itself, for any date.
3. As Alpir, I want participants and project taken from the meeting automatically and editable on the result screen, so fixing a mismatch never delays starting the recording.
4. As Alpir, I want the result to say which meeting the recording was linked to and let me switch it, so a wrong tap is cheap to fix.
5. As Alpir, I still want free recording with no meeting, so a quick conversation is not blocked.

---

## Acceptance criteria

### Meeting list on the recording screen

- **Given** I open the recording screen
- **Then** I see today's meetings (excluding `source = 'voice'`, day computed in the system timezone) as tappable rows ordered by time, each showing the time range, title, location when present, and participant names or count
- **And** a meeting running now or starting within 30 minutes carries an "עכשיו" pill
- **And** meetings that already ended are listed after the upcoming ones, dimmed, and still tappable
- **Given** more than 5 rows exist
- **Then** only the first 5 are shown with a "עוד פגישות להיום" control that expands the rest

### Tap to record

- **Given** the consent checkbox is checked (default, unchanged)
- **When** I tap a meeting row
- **Then** recording starts immediately for that meeting
- **Given** the consent checkbox is unchecked
- **Then** the rows are disabled and carry the hint "צריך לאשר הסכמה קודם"
- **Given** recording is in progress for a meeting
- **Then** the recording panel header shows the meeting title, time and participant names

### Free recording

- **Given** the list
- **Then** a final row "הקלטה חופשית · בלי פגישה" reveals the existing flow (people picker, project picker, input-device picker on web) unchanged
- **Given** today has no meetings
- **Then** the list is replaced by "אין פגישות ביומן להיום. אפשר להקליט שיחה חופשית." and the free-record flow is shown
- **Given** the meeting query fails
- **Then** the free-record flow is shown with "לא הצלחנו לטעון את היומן. אפשר להקליט בלי פגישה." and nothing is blocked

### Deep link from a meeting

- **Given** I open `/voice?meeting=<id>` (web) or `/record?meetingId=<id>` (mobile)
- **Then** that meeting is shown as a single preselected card with its date, participants and a "התחל הקלטה" button, plus "בחר פגישה אחרת" that returns to the list
- **Given** the id does not resolve
- **Then** the normal list is shown, with no error

### Linking and context inheritance

- **Given** I upload a recording with a meeting
- **Then** no placeholder meeting is created, `voice_recordings.meeting_id` is that meeting, and `matched_automatically` stays false
- **And** the recording's people are the union of the person ids the client sent and the meeting's `meeting_people` (people with `status = 'ignored'` excluded)
- **And** the recording inherits `meetings.project_id` when the client sent no project
- **Given** the recording completes
- **Then** the analysis uses that meeting's title, date and participant names (existing behavior in `processVoiceRecording`)

### Result screen

- **Given** a recording linked by explicit choice (`meetingLink === 'chosen'`)
- **Then** the result shows "מקושר לפגישה: `<title>`" with a "החלף פגישה" control that reveals the existing candidate list
- **Given** a recording linked by the post-upload automatic match (`meetingLink === 'auto'`)
- **Then** the existing "זוהתה אוטומטית" banner is shown instead
- **Given** an upload fails
- **Then** retrying keeps the chosen meeting (web `failedUpload` state, mobile `PendingUpload.meetingId`)

---

## Data model

**No schema change** in `packages/database/src/schema.pg.ts`, `packages/database/src/schema.ts` or the SQLite bootstrap in `packages/database/src/index.ts`. The feature reuses:

| Table | Column | Use |
|---|---|---|
| `voice_recordings` | `meeting_id` | The chosen meeting |
| `voice_recordings` | `created_meeting_id` | Already marks a placeholder meeting made for a standalone recording |
| `voice_recordings` | `matched_automatically` | Already marks a post-upload automatic match |
| `voice_recordings` | `project_id` | Inherited from the meeting when not sent |
| `meeting_people` | — | Source of the recording's participants |
| `meetings` | `title`, `date`, `time`, `end_time`, `location`, `project_id`, `source` | List rows and inherited context |

The link kind is derived, not stored:

- `meeting_id` null → `null`
- `created_meeting_id === meeting_id` → `'standalone'`
- `matched_automatically` → `'auto'`
- otherwise → `'chosen'`

---

## tRPC API

Router: existing `packages/api/src/routers/voice.ts`, all `protectedProcedure`.

| Procedure | Kind | Input | Returns |
|---|---|---|---|
| `voice.meetingChoices` | query | none | `{ meetings: MeetingChoice[] }` |
| `voice.meetingContext` | query | `{ meetingId: string }` | `MeetingChoice \| null` |

`MeetingChoice`:

```ts
type MeetingChoice = {
  id: string
  title: string
  date: string            // YYYY-MM-DD
  time: string            // HH:MM
  endTime: string | null
  location: string | null
  projectId: string | null
  projectName: string | null
  people: { id: string; name: string }[]
  state: 'now' | 'upcoming' | 'ended'
}
```

`meetingChoices` uses the existing `localDateTime` helper in `services/voice.ts` for both "today" and "now", rather than the UTC `toISOString()` that `meetings.list({ timeRange: 'today' })` uses — that one is wrong between 00:00 and 03:00 Israel time. `state` is computed server-side so web and mobile agree: `now` when the meeting is running or starts within 30 minutes, `ended` when its end (or start + 60 min when `end_time` is null) has passed, otherwise `upcoming`. Sort order is `now` first, then `upcoming` by time ascending, then `ended` by time descending.

Changes to existing procedures:

- `voice.get` and `voice.list` summaries gain `meetingLink: 'chosen' | 'auto' | 'standalone' | null`, derived in `summarize`.
- `voice.attachToPeople` is unchanged and powers "החלף פגישה".
- `voice.attachCandidates` is unchanged.

Service changes in `packages/api/src/services/voice.ts`:

- New `listMeetingChoices(db, options?: { now?: number })` and `getMeetingChoice(db, meetingId, options?: { now?: number })`, sharing one row-to-`MeetingChoice` mapper.
- `saveVoiceUpload`: when `input.meetingId` resolves, the inserted `voice_recording_people` rows are the union of the validated `input.personIds` and the meeting's `meeting_people` (dropping `people.status = 'ignored'`), and `projectId` falls back to the meeting's when the caller sent none.
- `summarize`: add `meetingLink`.

Mobile data helpers (`apps/mobile/lib/voice.ts`): `fetchMeetingChoices(token)` and `fetchMeetingChoice(token, meetingId)` over the existing `createTrpcClient` pattern; `MobileVoiceRecording` gains `meetingLink`.

---

## UI surface

### Web — `apps/web/src/app/voice/page.tsx`

The idle state becomes list-first:

1. Consent checkbox (moved above the list; default checked, unchanged copy).
2. `TodayMeetings` — section labelled "פגישות להיום", rows rendered as buttons inside a `role="group"` with `aria-label="פגישות להיום"`. Each row: time range (`tabular-nums`), title, optional "עכשיו" pill, location, participant names. Uses `.card card-interactive` and `.pill`. Disabled when consent is unchecked, with `aria-disabled` and the hint text.
3. `הקלטה חופשית · בלי פגישה` row — expands the existing people/project/input-device/tab-capture block and its "התחל הקלטה" button, all unchanged.

Supporting changes in the same file:

- `meeting` state holds the chosen `MeetingChoice`; `startFresh` accepts it.
- The active-recording panel shows a meeting header (title, time range, participant names) in place of today's people/project line.
- `doUpload` appends `meetingId` to the FormData and `failedUpload` keeps it so "שלח שוב" re-links correctly.
- `?meeting=` is read like `?person=` is today and resolved via `voice.meetingContext`.
- `RecordingResult` gets the "מקושר לפגישה" banner for `meetingLink === 'chosen'` (with "החלף פגישה" revealing the candidate fieldset) and keeps the auto banner for `'auto'`.

### Web — meeting entry points

- `apps/web/src/app/meetings/components/MeetingCard.tsx`: a `Mic` icon button linking to `/voice?meeting=<id>`, `aria-label="הקלט את הפגישה"`.
- `apps/web/src/app/meetings/[id]/page.tsx`: the same action as a `.btn .btn-ghost` with the label "הקלט פגישה".

### Mobile — `apps/mobile/app/(tabs)/record.tsx`

- The `consent` phase becomes list-first with the same three blocks (consent, meeting rows, free-recording section wrapping the existing `RecordingContextEditor`).
- Rows are `Pressable` with `accessibilityRole="button"` and a label including time and title, min height 44.
- `params.meetingId` plumbing is replaced by a `meeting` state that also drives `uploadVoiceRecording` and `PendingUpload`.
- The recording and result phases show the meeting header.

### Mobile — meeting entry points

- `apps/mobile/app/meeting/[id].tsx`: "הקלט פגישה" button routing to `/record?meetingId=<id>`.
- `apps/mobile/app/(tabs)/meetings.tsx`: a record action on each meeting row.

Per `apps/mobile/AGENTS.md`, check the Expo v56 docs before touching mobile APIs; this feature uses only APIs already in the file.

### Microcopy

| Element | Hebrew |
|---|---|
| Section label | פגישות להיום |
| Live pill | עכשיו |
| Row hint | הקש להתחלת הקלטה |
| Free row | הקלטה חופשית · בלי פגישה |
| Expand | עוד פגישות להיום |
| Empty | אין פגישות ביומן להיום. אפשר להקליט שיחה חופשית. |
| Load error | לא הצלחנו לטעון את היומן. אפשר להקליט בלי פגישה. |
| Consent blocked | צריך לאשר הסכמה קודם |
| Result banner | מקושר לפגישה: `<title>` |
| Switch | החלף פגישה |
| Meeting entry point | הקלט פגישה |

---

## Out of scope

1. Auto-starting a recording at meeting time, or notifying about it.
2. Writing anything back to Google or Apple Calendar.
3. Mapping transcript speakers to specific attendees.
4. Attendees that appear only in the event description with no matching person row — calendar sync already skips those.
5. Filtering the list by `agentCalendarIds`; an explicit tap shows all of today's meetings.
6. Recording a past meeting after the fact — the existing import and attach flow covers it.
7. Changing the post-upload automatic match in `findAutoMatchMeeting`; it stays as the fallback for recordings with no chosen meeting.

---

## Decisions

1. Tapping a row starts recording instantly, with the recording header and "החלף פגישה" as the safety net, rather than a confirmation step.
2. The list shows today only; any other day is reachable through the meeting's own record button.
3. The list includes all calendars, since the choice is explicit.

## Open questions

None.

---

## Testing notes

- Vitest (`packages/api/src/services/voice-meeting-choices.test.ts` or the existing voice suite):
  - `listMeetingChoices` excludes `source = 'voice'`, uses the system-timezone day, sets `state` correctly for now/upcoming/ended, and orders rows as specified.
  - `getMeetingChoice` returns `null` for an unknown id and a full row for a meeting on another date.
  - `saveVoiceUpload` with a `meetingId` seeds the meeting's attendees, skips `ignored` people, inherits the project, and creates no placeholder.
  - `processVoiceRecording` on a recording with a chosen meeting keeps `meetingId` and leaves `matchedAutomatically` false.
  - `summarize` returns each `meetingLink` value.
- Playwright (`apps/web/e2e`): seed a meeting with attendees for today, open `/voice`, assert the row and the "עכשיו" pill, assert the free-recording row reveals the people picker, and open `/voice?meeting=<id>` to assert the preselected card.
