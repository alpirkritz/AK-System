# Calendar Link & Commitment Task Modal

> **Slug:** `calendar-link-and-commitment-task-modal`
> **Status:** Draft
> **Last Updated:** 2026-10-19

## Goal

Two UX gaps to close:

1. **Calendar linking** — a recording started from a calendar event (`/voice?meeting=<id>` or
   mobile `/record?meetingId=<id>`) should arrive on the server with that meeting's ID, survive the
   "review before upload" confirmation step, and remain visible and changeable throughout. Currently
   the free-recording path calls `start(null)` / `startFresh(null)` even when a meeting was
   pre-selected, and the review panel does not show which meeting the recording belongs to, so
   `meetingId` is silently lost. In addition, a `voice`/`notion_note`/`manual`-sourced meeting
   summary page has no way to be retrospectively linked to a calendar event on the same date.

2. **Commitment → Task modal** — accepting a commitment on `/commitments` opens a small inline
   form (title, date, workspace). It should open the full `TaskModal` ("משימה חדשה") used
   everywhere else, pre-filled with the right title, assignee, project, related person and meeting,
   plus a short Hebrew explanation of why each field was pre-filled so the user can understand the
   context before saving.

---

## User Stories

- As Alpir, when I tap **הקלט פגישה** on a meeting card or meeting detail, I want the recording
  to stay tied to that meeting through the review step and upload, so I don't have to reattach it
  afterward.
- As Alpir, from the review panel, I want to see which meeting the recording belongs to and be
  able to change it, so a wrong tap is cheap to fix.
- As Alpir, on a voice/notion/manual meeting summary, I want a **שייך לאירוע ביומן** button that
  lets me pick a calendar meeting from the same date and merge everything into it, so corridor
  discussions connect to the right calendar event.
- As Alpir, when I accept a commitment, I want the full "משימה חדשה" dialog, pre-filled and
  annotated, so I understand why each field was suggested and can adjust before saving.

---

## Acceptance Criteria

### Feature 1 — Calendar recording link survives review

- [ ] On web `/voice?meeting=<id>`: the "Free recording" **התחל הקלטה** button stays hidden or
  secondary; the primary CTA is **הקלט — `<meeting title>`**. Clicking it calls
  `startFresh(presetMeetingChoice)` (not `startFresh(null)`).
- [ ] On mobile `/record?meetingId=<id>`: the `start()` call from the preset-meeting row passes
  `presetMeeting` (not `null`), same as it already does for the meeting-list rows.
- [ ] Review panel (web and mobile) shows a locked "מקושר לפגישה: `<title>`" row with a
  "החלף" link that opens a list of same-day calendar meetings. Choosing one updates `pendingReview.meetingId` / mobile `meeting` state. Clearing keeps the original choice but lets the user switch to "בלי פגישה" explicitly.
- [ ] When the upload is confirmed, `meetingId` is passed to the server correctly in all paths:
  normal stop→review→upload, retry-after-failure, import on mobile.

### Feature 1 — Attach to calendar meeting from summary

- [ ] On a meeting detail page (`/meetings/[id]`) whose `source` is `voice`, `notion_note`, or
  `manual`, a **שייך לאירוע ביומן** button is visible in the metadata row.
- [ ] Clicking it opens a dropdown / popover listing calendar meetings (`source = 'calendar'`) from
  the same `date` as the current meeting, ordered by time.
- [ ] Selecting a calendar meeting calls `trpc.meetings.attachToCalendar({ meetingId, calendarMeetingId })`.
- [ ] The procedure moves: meeting analyses, voice recordings (`meetingId` FK), Notion meeting
  notes (`meetingId` FK), tasks (`meetingId` FK), and voice commitments (`sourceId` where
  `source = 'voice'`) from `meetingId` to `calendarMeetingId`.
- [ ] If `meetings.createdMeetingId` of any attached voice recording equals `meetingId` (the
  placeholder), those recordings' `createdMeetingId` is cleared and the placeholder meeting is
  deleted after all FKs have been moved.
- [ ] After success the page navigates to `/meetings/<calendarMeetingId>`.
- [ ] `attachToCalendar` is a `protectedProcedure` on the `meetings` router.

### Feature 2 — Commitment accept opens TaskModal

- [ ] On `/commitments`, the **קבל** button opens `TaskModal` (not the inline form).
  The inline form is removed.
- [ ] A new tRPC query `commitments.taskPrefill({ commitmentId })` returns:
  ```ts
  {
    title: string            // commitment content
    dueDate: string | null   // dueInferred
    assigneeId: string | null  // selfPerson if owner==='me', personId if owner==='them'
    projectId: string | null   // first project linked to the person
    meetingId: string | null   // if source==='meeting_analysis'|'voice', the source meeting id
    relatedPersonIds: string[]  // [personId] when personId exists
    explanation: string      // Hebrew, one paragraph e.g. "ממקור: WhatsApp / עם X · פרויקט Y — הפרויקט הראשי של X · פגישה Z — ההתחייבות יצאה מהסיכום שלה"
  }
  ```
- [ ] `TaskModal` renders the `explanation` string in a small grey block above the fields when it
  is non-empty (`props.explanation?: string`).
- [ ] After the user submits `TaskModal`:
  1. `tasks.create` is called as normal (existing path).
  2. `commitments.accept({ commitmentId, taskId: created.id })` is called to mark the commitment
     as accepted and link the task, without creating a second task.
- [ ] `commitments.accept` is extended to accept an optional `taskId: string` input. When
  provided, the procedure skips `tasksRouter.createCaller(ctx).create(...)` and uses the supplied
  `taskId` directly.
- [ ] The success banner changes from "נוצרה משימה" to "נוצרה משימה ·
  <Link href="/tasks">למשימות</Link>" (already present — keep it).
- [ ] The `workspaces` data needed by `TaskModal` is fetched on the commitments page via
  `trpc.workspaces.list` (already queried).
- [ ] People, meetings, projects data are fetched on the commitments page for `TaskModal` (same
  as `PersonDetailDrawer` and `page.tsx` pages do).

---

## Data Model

No schema changes. All moved data uses existing FK columns (`meetingId`, `sourceId`) already
present in `voice_recordings`, `meeting_analyses`, `meeting_notes`, `tasks`, `commitments`.

---

## tRPC API

### `meetings` router — new procedure

```ts
attachToCalendar: protectedProcedure
  .input(z.object({
    meetingId: z.string().min(1),          // source (voice/notion/manual)
    calendarMeetingId: z.string().min(1),  // target (source=calendar)
  }))
  .mutation(...)
```

Moves all child rows; deletes placeholder meeting if applicable.
Returns `{ calendarMeetingId: string }`.

### `commitments` router — new query

```ts
taskPrefill: protectedProcedure
  .input(z.object({ commitmentId: z.string().min(1) }))
  .query(...)
```

Returns the prefill object described in the acceptance criteria.

### `commitments.accept` — extend input

Add optional `taskId: z.string().optional()`. When present, skip internal task creation; set
`commitments.taskId = input.taskId` and `status = 'accepted'`.

---

## UI Surface

### `apps/web/src/app/voice/page.tsx` (idle state)

- When `presetMeeting` is set, the **התחל הקלטה** button in the free-recording column is replaced
  with a secondary link "הקלטה חופשית (בלי הפגישה)" that calls `startFresh(null)`.
- The primary button in the preset-meeting column already calls `startFresh(presetMeetingChoice)` — verify this path is correct; if it calls `startFresh(null)` anywhere when a preset is known, fix it.
- Review panel: add a "פגישה: `<title>`" row above the people picker. Show a same-day meeting
  picker (reuses `trpc.voice.meetingChoices` filtered by date) if the user clicks "החלף".

### `apps/mobile/app/(tabs)/record.tsx` (consent/result phase)

- The **preset-meeting row** `onPick` already calls `void start(presetMeeting)` — verify it; no
  change needed if correct.
- Review phase (`phase === 'review'`): add a row "פגישה: `<title>`" below the people/project
  editor. A "החלף" Pressable opens a Modal with the same-day list from `meetingChoices`. Clearing
  sets `meeting` to `null`.

### `apps/web/src/app/meetings/[id]/page.tsx`

- In the metadata row, when `meeting.source !== 'calendar'` and `meeting.source !== undefined`:
  add a button **שייך לאירוע ביומן** that opens a popover.
- Popover lists calendar meetings from same date (new query: `trpc.meetings.calendarOnDate({ date })`).
- On pick: call `attachToCalendar` mutation, then `router.push('/meetings/<calendarMeetingId>')`.

### `apps/web/src/app/commitments/page.tsx`

- Remove the inline `<form>` rendered when `editingId === c.id` (lines ~307-340).
- Replace with `TaskModal` opened via `trpc.commitments.taskPrefill`.
- State: `prefillLoading`, `prefillData`. On **קבל** click: fetch prefill, then open modal.
- `onCreated` callback: call `commitments.accept({ commitmentId, taskId: task.id })`.

### `apps/web/src/components/Modals/TaskModal.tsx`

- Add optional prop `explanation?: string`.
- When set, render a `<p>` block in grey (`text-[#97a4c2] text-xs`) above the title field.

---

## Out of Scope

- Adding a "הקלט" button directly inside `EventDetailPanel` (the calendar grid panel) — the
  existing flow via `/voice?meeting=` is sufficient.
- Moving the `calendarId` linkage (full calendar sync scope changes from `recording-auto-calendar-context.md` spec, still draft).
- Mobile: `attachToCalendar` from the meeting detail — only web for now.
- Moving Notion notes FK (`meeting_notes.meetingId`) to the calendar meeting in `attachToCalendar`
  — only `meeting_analyses`, `voice_recordings`, `tasks`, and voice `commitments` are moved.

---

## Open Questions

- None blocking implementation.
