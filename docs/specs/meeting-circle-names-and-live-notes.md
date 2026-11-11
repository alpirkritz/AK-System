# Meeting circle names and live recording notes

> **Slug:** `meeting-circle-names-and-live-notes`
> **Status:** Draft
> **Last Updated:** 2026-10-28

## Goal

Dragontail calendar descriptions store Outlook names as "Last, First <email>", and the participant parser splits that comma into two people. Keep each of those as one person shown as "First Last", and let a recurring meeting's circle be written by hand. On the web recording screen, show the saved meeting prep and capture follow-up notes onto the meeting.

## User Stories

- As the owner, I want "כהן, יוסי <email>" from a Dragontail event to stay one person named "יוסי כהן", so the circle is not full of split names.
- As the owner, I want to type the circle once on a recurring meeting and save it, so later occurrences keep the names I chose.
- As the owner, I want to see the meeting prep and jot notes while recording on the web, so I do not forget what to handle afterwards.

## Acceptance Criteria

- [ ] `parseDescriptionParticipants` reads `משתתפים: כהן, יוסי <yossi@dt.com>, לוי, דנה <dana@dt.com>` as two people, "יוסי כהן" and "דנה לוי", each with their email.
- [ ] `Dana Levi <dana@dt.com>, Yossi Cohen <yossi@dt.com>, Guest Only` still parses as three people with unchanged names.
- [ ] A series meeting shows a textarea (one person per line) and "שמור כחוג". Saving sets `rosterSavedAt` and the active roster to those names. A line `כהן, יוסי` is stored as `יוסי כהן`.
- [ ] Saving again replaces the active roster: omitted rows become `inactive` (not deleted). A row whose name still matches keeps its `personId`. New and re-saved rows use `source = manual`, so a later calendar diff does not retire them for being absent from the calendar.
- [ ] "שמור חוג מהיומן" still works when the calendar has participants.
- [ ] While a web recording is in progress, and on the pre-upload review step, a "הערות להמשך" field is shown. When a meeting is linked, the text is merged into `meetings.notes` without removing notes that were already there, and a second save replaces the recording block instead of duplicating it.
- [ ] When a meeting is linked, the same screen shows `meetings.getPrep` `bodyText` above the notes. If none exists, the line is "אין עדיין הכנה לפגישה". No prep is created from this screen. With no linked meeting, the prep block is hidden.
- [ ] A one-off meeting with no series has no circle editor. The mobile app is unchanged.

## Data Model

No new tables or columns. `meetings.notes` (already nullable text on `meetings` in both `packages/database/src/schema.ts` and `packages/database/src/schema.pg.ts`) stores the recording block. `series_roster.source = 'manual'` and `meeting_series.roster_saved_at` are existing columns.

## tRPC API

All procedures stay on `protectedProcedure`.

- `circles.saveFromNames`
  - Input: `{ seriesId: z.string().min(1), names: z.array(z.string().trim().min(1)).min(1).max(200) }`
  - Return: `{ saved: number }`
  - Unknown series → `NOT_FOUND`. Names that parse to nobody → `BAD_REQUEST`.
- `meetings.saveRecordingNotes`
  - Input: `{ meetingId: z.string().min(1), notes: z.string().max(20000) }`
  - Return: `{ notes: string | null }`
  - Writes only `meetings.notes`. Does not call `meetings.update`, because that mutation also rewrites title, project, type, and recurrence.
  - Unknown meeting → `NOT_FOUND`.
- `meetings.getPrep` is unchanged and is what the recording screen reads.

## UI Surface

- `apps/web/src/app/meetings/components/CircleCard.tsx` on `/meetings/[id]` when the meeting has a series. Textarea label "שמות בחוג", button "שמור כחוג", above the existing calendar save and roster. Desktop and the existing responsive web layout; no mobile app change.
- `apps/web/src/app/voice/page.tsx` while recording and on the review step: read-only prep (`data-testid="voice-meeting-prep"`) and the notes textarea (`הערות להמשך`). Web only.

## Out of Scope

- Deleting circles already saved from the old split.
- Changing the Outlook bridge description format.
- Recording notes or prep on ARO / mobile.
- Creating a prep from the recording screen, or turning each note line into a task.

## Open Questions

None. The approved plan fixes the parser, adds the circle textarea on series meetings, and shows prep plus notes on the web recorder.
