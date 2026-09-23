# Meeting analysis attendees — add, remove, and link to People

> **Slug:** `meeting-analysis-attendees`
> **Status:** Implemented
> **Last Updated:** 2026-09-23

Detected stack: `next-trpc-monorepo`

## Goal

After a conversation analysis, suggested participant names are display-only: there is no way to add someone the analysis missed, no way to dismiss a wrong name, and accepting a name does not create a People record or attach them to the meeting (`meeting_people`). Linking tried to write a `peopleIds` column that does not exist on `meetings`.

The user can add or remove people on the meeting. Everyone who stays is a confirmed person in אנשים and a participant on that meeting.

## User Stories

- As the owner, I want to add a suggested name to the meeting so they become a real contact and show up on the event.
- As the owner, I want to dismiss a wrong suggestion so it leaves the meeting and the recommendation list, without deleting the contact.
- As the owner, I want to add someone the analysis did not mention, by picking an existing contact or typing a new name.
- As the owner, I want a name that already exists in אנשים to be reused, so I do not get a duplicate contact.

## Acceptance Criteria

- [ ] Given a completed analysis with a participant name that matches no confirmed contact, when the user chooses "צור והוסף", then a `people` row is created with `status = confirmed` and a `meeting_people` row links that person to the meeting.
- [ ] Given a participant name that matches exactly one non-ignored person, when the user chooses "הוסף לפגישה", then that existing person is linked and no second person is created. An `unconfirmed` match is promoted to `confirmed`.
- [ ] Given two non-ignored people with the same name, when accept is called without `personId`, then the server rejects the call and the UI asks the user to pick one.
- [ ] Given a suggested participant, when the user chooses "הסר" and confirms if they are already on the meeting, then the name is removed from the analysis participants and any `meeting_people` link for that person on this meeting is deleted. The `people` row remains.
- [ ] Given the meeting attendees card, when the user adds an existing contact or a new name, then that person is on the meeting and visible in אנשים.
- [ ] Given the meeting attendees card, when the user confirms removal, then the person leaves this meeting and remains in אנשים.
- [ ] Given `linkAnalysisParticipant`, when it succeeds, then the person is inserted into `meeting_people` (not a JSON column on `meetings`).

## Data Model

No schema changes. Membership stays in `meeting_people` (`packages/database/src/schema.ts` and `schema.pg.ts`). Analysis participants stay in `meeting_analyses.participants_json` as `{ name, confirmed, personId? }`.

New people use existing columns: `status = confirmed`, `source = manual`.

## tRPC API

All procedures are `protectedProcedure` on `meetings`.

- `attachPerson` — input `{ meetingId: string, personId?: string, name?: string }` (exactly one of `personId` or `name`). Returns `{ personId, name, created }`. Resolves or creates the person, then inserts `meeting_people` if missing.
- `detachPerson` — input `{ meetingId: string, personId: string }`. Returns `{ ok: true }`. Deletes the join row only.
- `acceptAnalysisParticipant` — input `{ analysisId: string, participantIndex: number, personId?: string }`. Resolves the person (explicit id, unique name match, or create), sets `personId` + `confirmed: true` on that participant, and attaches them to the meeting. Returns `{ personId, name, created }`.
- `removeAnalysisParticipant` — input `{ analysisId: string, participantIndex: number }`. Drops that participant from the JSON and detaches `personId` from the meeting when set. Does not delete the person. Returns `{ ok: true }`.
- `linkAnalysisParticipant` — keep the input. After updating the participant JSON, insert `meeting_people`.
- `confirmAnalysisParticipant` — same effect as `acceptAnalysisParticipant` without `personId` (create or match, then attach). The UI no longer offers "confirm as-is" without a person.

Name matching is trimmed and case-insensitive. `ignored` people are not auto-matched. More than one usable match returns `CONFLICT` with message `כמה אנשי קשר עם אותו שם. בחר אחד מהרשימה.`

## UI Surface

Web meeting detail only: `apps/web/src/app/meetings/[id]/page.tsx` and `apps/web/src/app/meetings/components/ConversationAnalysis.tsx`.

**Attendees card (the event)** — one primary add action, `+ הוסף אדם`:

- Search existing contacts, or create when the typed name has no exact match (`צור איש קשר «שם» והוסף לפגישה`).
- Each row has `הסר`. Confirm copy: `להסיר את {name} מהפגישה? איש הקשר יישאר באנשים.` with `הסר` and `ביטול`.
- Empty: `עדיין אין משתתפים בפגישה` plus the add button.

**Analysis suggestions** — each name is a row, not a dead chip:

- Not on the meeting, no match: `צור והוסף` and `קשר לקיים`.
- Not on the meeting, one match: `הוסף לפגישה` and `קשר לאחר`.
- Several matches: `בחר איש קשר`.
- Already on the meeting: label `בפגישה` and `הסר` (same confirm as the card, and also drops the suggestion).
- A suggestion that was never added can be removed without a confirm dialog.
- The same `+ הוסף אדם` control sits under the suggestions for someone the analysis missed.
- Buttons use `.btn` / `.btn-primary` / `.btn-ghost`, at least 44px tall. Errors show the server message in Hebrew. Pending disables the row actions.

## Out of Scope

- Mobile conversation analysis (chips stay read-only).
- Deleting a person from אנשים.
- Notion write-back of attendees.
- Changing analysis prose (mood, kaizen, action items).

## Open Questions

None. Duplicate names require an explicit pick. Removal never deletes the contact.
