# Owner identity everywhere

## Goal

Hugo and every other model prompt know the user is Alpir Kritzler (אלפיר קריצלר), and recorded conversations never turn him into another contact or a suggested participant. He recorded the conversation and is already in it.

## User stories

- As Alpir, I want every agent to know I am Alpir Kritzler, so replies address me and do not talk about me as a third party.
- As Alpir, I want a recorded conversation to treat me as already present, so analysis lists the other people only.
- As Alpir, I want the name אלפיר / Alpir / אלפיר קריצלר to resolve to my existing contact, so the system does not create a second person for me.
- As Alpir, I want an old analysis that already listed me to stop offering me as someone to add.

## Acceptance criteria

- Given any ABC agent run (Hugo or a specialist, web or WhatsApp), the system instruction contains the principal block: Alpir Kritzler / אלפיר קריצלר, second person, omit him from people and participant lists, every recording includes him.
- Given a transcript analysis, the prompt states the same, and returned `participants` drop names that are only the owner (`Alpir`, `אלפיר`, `Alpir Kritzler`, `אלפיר קריצלר`, or `NOTION_USER_NAME`).
- Given a stored analysis that still lists the owner, `meetings.getAnalysis` and `voice.getAnalysis` omit him, and accept/remove/link use that same visible list.
- Given `people.create` or meeting-attendee resolution with an owner name, the call returns the existing self row and does not insert another person.
- Given a task that is his (Notion assignee, a new task with no assignee, or an action item he owns), `assigneeId` is his row so the task is his, and it is not linked in `task_people` or listed on the Alpir Kritzler contact. The assignee label is "אני".
- Given voice enrollment, the voiceprint is stored on the canonical self person (`Alpir Kritzler`), not on a new row named `אלפיר`.

## Data model

No schema change. `packages/database/src/schema.ts` and `schema.pg.ts` stay as they are. The owner remains the `people` row whose name equals `getSelfPersonName()` (`NOTION_USER_NAME`, default `Alpir Kritzler`).

## tRPC API

No new procedures. Existing behavior changes:

- `people.create` (`packages/api/src/routers/people.ts`, mutation): when `name` is an owner alias, update and return the self row. Input shape unchanged.
- `meetings.getAnalysis` / `voice.getAnalysis` (queries): `participants` omits owner aliases. Indices match `meetings.acceptAnalysisParticipant`, `removeAnalysisParticipant`, and `linkAnalysisParticipant`.
- `meetings.analyzeTranscript` (mutation): stored `participants` omit owner aliases.

## UI surface

No new screen. Meeting analysis and voice analysis already render `participants` from those queries, so the owner disappears from "משתתפים מומלצים" without a layout change.

## Out of scope

- Deleting an existing duplicate contact named `אלפיר`. Voice links and the voiceprint move to the canonical row; the old contact row stays until Alpir merges it.
- Renaming `דובר N` labels inside the transcript.
- A settings screen to change the owner name. `NOTION_USER_NAME` remains the override.

## Open questions

- None.
