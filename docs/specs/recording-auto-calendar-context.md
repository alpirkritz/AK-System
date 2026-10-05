# Auto-Link Recordings to Calendar Meeting Context

**Stack:** `next-trpc-monorepo` (backend) + `expo` (mobile)
**Slug:** `recording-auto-calendar-context`
**Status:** Draft
**Created:** 2026-09-30
**Relates to:** `voice-capture-deep-analysis` (defines the recording pipeline this extends), `recording-background-and-speaker-id` (draft, not yet implemented — unaffected by this spec)

---

## Goal

Today, Notion-sourced meeting notes get automatically matched to the right calendar meeting (title + date) with no user action. In-app voice recordings do **not** get this treatment: `attachCandidates` only surfaces a manual pick-list of same-day, time-overlapping meetings after upload, and if nothing is picked, the system creates a generic placeholder meeting ("שיחה מוקלטת") with no title or participants. This spec makes recordings automatically detect and attach to the right calendar meeting — title and participants — for meetings the user has opted into, the same way Notion already works. Not every calendar event should trigger this (personal/private events shouldn't auto-capture a recording); the user chooses which calendars are in scope.

---

## User Stories

1. **As a user**, when I record a conversation during a meeting that's on my calendar (from a calendar I've opted in), I want the recording automatically linked to that meeting — correct title, correct participants — without picking it from a list afterward.
2. **As a user**, I want to control which calendars are eligible for this auto-linking (e.g. my work calendar yes, a shared family calendar no), so I don't get every calendar event auto-tagged.
3. **As a user**, if the system isn't confident which meeting a recording belongs to (multiple overlapping candidates, or no calendar-sourced meeting nearby), I want to fall back to today's manual pick-list rather than have it guess wrong silently.
4. **As a user**, if a recording does get auto-matched, I want to see what it matched to and be able to change it, in case it's wrong.
5. **As a user**, I want this to also work for imported recordings (e.g. Samsung call recordings), matched by the file's timestamp against my calendar.

---

## Acceptance Criteria

### Calendar Scope Setting
- **Given** I have calendars marked under the existing "יומנים לסוכנים" setting (`/settings`, `agentCalendarIds` — today used to scope Hugo/Opti/morning briefs)
- **When** I haven't touched anything new for this feature
- **Then** recording auto-link uses that same scope, with the same "all calendars" default: `agentCalendarIds = null` means every calendar is in scope for auto-linking too, so the feature is **on by default** for all calendars, no separate opt-in step
- **Given** I narrow "יומנים לסוכנים" to specific calendars (for the agent use case)
- **Then** recording auto-link scope narrows the same way, since it's the same setting — there is no separate calendar toggle list for recordings

### Automatic Matching (Live Recording)
- **Given** a recording finishes uploading
- **When** the server looks for a meeting to attach it to
- **Then** it first searches calendar-sourced meetings (`meetings.source === 'calendar'`) whose calendar belongs to the user's opted-in scope, with a start/end time overlapping `[recording start − 15min, recording end + 15min]`
- **Given** exactly one such calendar meeting is found
- **Then** the recording is attached to it automatically (`meetingId` set, no placeholder meeting created); participants are whatever `meetingPeople` the calendar sync already linked for that meeting (email-matched at sync time) — nothing new to resolve
- **Given** zero or more than one calendar meeting overlaps the window
- **Then** no automatic attach happens — the existing manual "attach candidates" flow is shown instead (today's behavior, unchanged), and if nothing is picked, the placeholder meeting is created as today

### Confirmation UI
- **Given** a recording was auto-matched
- **When** I view the recording result screen
- **Then** I see a banner: "זוהתה אוטומטית: <meeting title> — <participant names>" with a "לא נכון? בחר פגישה אחרת" link that opens today's manual candidate list to override
- **Given** a recording was NOT auto-matched
- **Then** the screen behaves exactly as today (manual candidate list or placeholder)

### Imported Recordings
- **Given** I import an external recording (Samsung call recorder, etc.)
- **When** the file's timestamp (creation time, or user-entered time if metadata is missing/unreliable) falls in an opted-in calendar meeting's window
- **Then** the same automatic-match logic applies as for live recordings

### Auto-Match Tracking
- **Given** a recording was attached automatically vs. manually
- **Then** the system records which happened (`matchedAutomatically: true/false`), so the UI can distinguish "the system tagged this" from "I picked this," consistent with the pattern already planned for speaker tagging in `recording-background-and-speaker-id`

---

## Data Model Changes

### `schema.pg.ts` / `schema.ts`

**No new scope setting.** This reuses the existing `userSettings.agentCalendarIds` (already `null` = all calendars, which is also the desired default here — auto-link on by default for every calendar). `getAgentCalendarIds()` from `agent-calendar-scope.ts` is called as-is from the new matching logic.

**Correction found during implementation — `meetings` needs a new `calendarId` column.** `filterEventsByCalendarScope` today filters *live* fetched calendar events (which carry `calendarId`, e.g. from `fetchGoogleCalendarEvents`/`makeGoogleCalendarId`), never persisted `meetings` rows. The `meetings` table only stores `calendarEventId` (the event's own id) and `calendarSource` (`'google'|'apple'`) — there is no column identifying *which* calendar (of possibly several connected ones) a synced meeting came from. Since `calendar-sync`'s cron always syncs with `calendarIds: null` (all calendars, unconditionally — see `apps/web/src/app/api/cron/calendar-sync/route.ts:34`), every calendar's events already become `meetings` rows regardless of `agentCalendarIds`; scope is applied only at *read* time elsewhere (agent prompt, morning briefing). To let auto-match filter by scope at all, `meetings` needs to remember the source calendar:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `calendarId` | text | NULL | The connected calendar's id (as returned by `fetchGoogleCalendarEvents`/`fetchAppleCalendarEvents`, e.g. `makeGoogleCalendarId(accountEmail, cal.id)`), set at sync time in `routers/meetings.ts`'s calendar-sync procedure alongside `calendarEventId`/`calendarSource`. `null` for `manual`/`notion_note`/`voice`-sourced meetings. |

Mirror in `schema.ts`, add the bootstrap `ALTER TABLE meetings ADD COLUMN calendar_id text` in `packages/database/src/index.ts`, and backfill is not possible for already-synced rows (no way to recover which calendar an existing row came from) — those rows simply have `calendarId = null` and are treated as in-scope everywhere until the next sync updates them (existing-row `UPDATE` path in the sync procedure should also start setting `calendarId`, so previously-synced meetings self-heal on their next sync pass).

**Extend `voiceRecordings`:**

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `matchedAutomatically` | integer (bool) | NOT NULL | `0` | Set `1` when `meetingId` was assigned by the auto-match logic in this spec rather than by manual attach or placeholder creation |

Mirror both in `schema.ts` (SQLite) and add the corresponding bootstrap `ALTER TABLE` statements in `packages/database/src/index.ts`.

---

## Backend Changes

### `packages/api/src/routers/meetings.ts` (calendar-sync procedure)

- Both the INSERT path (~line 728) and UPDATE path (~line 707) for calendar-sourced meetings now also set `calendarId: ev.calendarId ?? null`, so every synced meeting remembers which connected calendar it came from (see Data Model correction above).

### `packages/api/src/services/voice.ts`

- New function `findAutoMatchMeeting(recording)`: calls `getAgentCalendarIds()` (from `agent-calendar-scope.ts`, reused as-is — `null` = all calendars), then queries `meetings` where `source = 'calendar'` AND (`calendarId IN scope` OR `calendarId IS NULL` OR scope is `null`) AND time window overlaps (reusing the existing `ATTACH_WINDOW_MIN` constant, applied both sides — see Open Questions on window size). A `null` `calendarId` (not-yet-resynced legacy row) is treated as in-scope rather than excluded, per the self-healing note above. Returns a single match or `null` (never picks among multiple).
- `processVoiceRecording`: before falling through to placeholder-meeting creation, call `findAutoMatchMeeting`. On a single match: set `meetingId` to the matched meeting directly — **no participant re-resolution needed**, since calendar-sourced meetings already have real `meetingPeople` rows populated by `linkAttendees` at sync time (email-matched against `people.email`); the recording simply attaches to the existing meeting and its existing attendees, same as picking it manually from today's candidate list would do. Set `matchedAutomatically = true`. On no/multiple matches: unchanged existing behavior (placeholder meeting creation from the recording's own tagged `people`, as today).
- `fetchAttachCandidates` response gains `autoMatched: boolean` and the auto-matched meeting (if any) is still returned as the top/only candidate so the confirmation-override UI can reuse it.

### `packages/api/src/services/agent-calendar-scope.ts`

- No changes — `getAgentCalendarIds()` and `filterEventsByCalendarScope()` are called directly from the new voice-matching code. The scope is shared between the AI-agent prompt context and recording auto-link, per decision above.

### tRPC

- No new procedures needed for scope (reuses `settings.agentCalendars.get`/`.set`, already implemented).
- `voice.fetchAttachCandidates` — extend response shape with `autoMatched: boolean`.

---

## UI Surface

### Web Settings (`apps/web/src/app/settings/page.tsx`)

No new settings section. The existing "יומנים לסוכנים" block (~line 1004-1044, `CalendarCheckboxList`, backed by `trpc.settings.agentCalendars`) gets one line added to its description text to reflect the new dual purpose, e.g.: "הוגו, אופטי, סיכומי בוקר **וזיהוי אוטומטי של הקלטות** יתייחסו רק ליומנים שסימנת" — no new component, no new tRPC calls, since scope is fully shared.

### Mobile `RecordingResult` (in `record.tsx`) and Web `RecordingResult` (`apps/web/src/app/voice/page.tsx`)

Both surfaces render the same candidate flow off `attachCandidates`, so both get the same treatment:
- When `autoMatched === true`: banner above the candidate list/radio group showing the matched meeting title + participant names, plus a text link "לא נכון? בחר פגישה אחרת" that reveals today's existing candidate-list UI (collapsed by default in this case).
- When `autoMatched === false`: unchanged — today's UI exactly.
- Web-specific note: the candidate radio group's local `meetingId` state already defaults to `''` (no meeting) regardless of `rec.meetingId`, and is only sent on submit if the user actively picks a radio option — so an auto-matched recording is safe from being silently detached by an unrelated "save" (e.g. editing participants) as long as the user doesn't explicitly pick "בלי פגישה". No change needed to that logic, just the added banner for clarity.

---

## Out of Scope

1. Real-time / mid-recording detection — matching still happens after the recording finishes uploading, same timing as today.
2. Changing how calendar participants get matched to `people` rows — already handled by the existing email-based `linkAttendees` logic in the calendar-sync procedure; this spec only consumes its output (`meetingPeople`), it doesn't touch that matching logic.
3. Multi-account calendar ID collisions across different connected Google accounts — assumes calendar IDs are unique per user as they are today.
4. Changing Notion's own matching logic (`notion-meeting-sync.ts`) — untouched, already works.
5. Any changes from `recording-background-and-speaker-id` (background recording, speaker ID) — that spec is independent and still in Draft.

---

## Decisions (resolved 2026-09-30)

1. **Shared scope setting:** confirmed — reuse `userSettings.agentCalendarIds` as-is, no separate setting, no new settings UI.
2. **Default state:** confirmed — on by default (`agentCalendarIds = null` = all calendars in scope), not opt-in.
3. **Confirmation banner:** confirmed — auto-matched recordings always show the "זוהתה אוטומטית: ..." banner with an override link; never silent.

## Open Questions

1. **Match window size:** is the existing ±15 min `ATTACH_WINDOW_MIN` right for auto-match too, or should auto-match use a tighter window (since it acts without confirmation) than the manual candidate list?
2. **Imported-file timestamp reliability:** file creation-time metadata isn't always trustworthy (e.g. files transferred between devices can lose original timestamps) — should there be a manual "when was this call" field on the import screen as a fallback anchor?
3. **Tie-break instead of bail:** when multiple calendar meetings overlap, should the system pick the closer/more-overlapping one automatically (with the confirmation banner making the guess visible and correctable) rather than falling back to full manual selection? This would raise the automation rate at the cost of occasional wrong-but-correctable guesses.

---

## Testing Notes

- Vitest: `findAutoMatchMeeting` — single match auto-attaches, zero matches falls through, multiple matches falls through, calendar outside scope is ignored, calendar inside scope but wrong time window is ignored.
- Vitest: `matchedAutomatically` flag correctly set/unset across the above cases.
- Playwright/manual: with default (all-calendars) scope, recording during any calendar meeting auto-attaches; after narrowing "יומנים לסוכנים" to specific calendars, recording during an excluded calendar's meeting falls back to manual candidates; override link correctly re-attaches to a different meeting.
