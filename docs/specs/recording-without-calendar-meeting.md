# Recording without a calendar meeting keeps its notes and shows up as a meeting

> **Slug:** `recording-without-calendar-meeting`
> **Status:** Draft — awaiting approval
> **Last Updated:** 2026-11-01

## Goal

Notes typed on `/voice` while recording are only saved when a meeting is linked (`linkedMeetingId`). Recording started with no meeting loses the notes (React state, cleared after upload), and save errors are swallowed. Make every recording land on a meeting, so notes are never lost and unscheduled conversations appear in the meetings list.

## User Stories

- As the owner, I want notes typed during any recording saved, even if the meeting is not in my calendar.
- As the owner, I want a recording made without a calendar event to appear as a meeting in /meetings.
- As the owner, I want to see when saving notes failed.

## Acceptance Criteria

- [ ] Starting a recording with no meeting selected creates a manual meeting (`source = 'manual'`, unique id, date/time = now, title "שיחה <date> <time>") and links it as `meeting`.
- [ ] The meeting title can be edited on the review step; the recording is linked via `meetingId` on upload (existing flow).
- [ ] Notes autosave to that meeting via `saveRecordingNotes` exactly as for calendar meetings.
- [ ] A failed save shows an inline "השמירה נכשלה — ננסה שוב" message and retries on the next change; notes stay in the textarea.
- [ ] Cancelling the review of a manually created meeting with no recording and empty notes deletes that meeting.
- [ ] Manual meetings appear in /meetings (timeline and "עברו") with a "ידני" badge.

## Data Model

None. Uses existing `meetings.source = 'manual'` and `meetings.notes`.

## tRPC API

- `meetings.createManual({ title?, date, time })` — reuse if it exists from the manual-meeting work; otherwise add.
- `meetings.deleteIfEmpty({ meetingId })` for the cancel case.

## Out of scope

Recovering notes already lost; mobile app.

## Open questions

- Create the meeting at record start (recommended) or only at stop?
