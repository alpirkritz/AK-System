# Meeting prep from summaries (everyone, Con/DAZ actions)

> **Slug:** `meeting-prep-from-summaries`
> **Status:** Approved
> **Last Updated:** 2026-08-30
> **Stack:** `next-trpc-monorepo`

## Goal

Hugo and meeting-prep must use AI meeting summaries for **every** person and meeting, not only שני/Shani — including **Con Meetings** and DAZ **Internal Meetings** / **Meetings & Interactions**, in the same brief shape as DT Meetings. Tomorrow (or any day) prep loads prior summaries for whoever is on that day's calendar, and related open tasks from **all** Notion task DBs — including **Con Action items** and **DAZ Tasks**.

## User Stories

- As the owner, when I ask about anyone or “כולם”, I want summaries and related meetings for those people, not only the last named person (שני).
- As the owner, when I ask to prepare for tomorrow, I want each meeting briefed from prior AI summaries plus related Con / DAZ / DT action items.
- As the owner, I want the same brief structure for Con Action items and DAZ Tasks as for DT meeting-note action items: related open items only, never a full backlog dump.

## Acceptance Criteria

- [x] Given `get_notion_meeting_notes` with `prepDate: tomorrow` (or `today` / YYYY-MM-DD), when local meetings exist that day, then notes from the last 60 days that match those meetings (title fuzzy, known person in title, or `meeting_people` / `meeting_note_people`) are returned — not only a `query` for one name.
- [x] Given a day-prep ask (מחר / תכין אותי ליום / כולם) and no single person named, when Hugo calls notes, then it uses `prepDate` and does **not** pass a leftover person `query`.
- [x] Given a named person (any CRM name, Hebrew aliases included), when asked about that person, then `query` still filters to them.
- [x] Given `get_notion_tasks`, when meeting prep runs, then tasks from every configured tasks DB are eligible (Personal To-do, DT - Action items, **Con Action items**, **DAZ Tasks**); relatedness stays person/project/topic — never dump the full backlog.
- [x] Given a calendar title that contains a **known** CRM person (e.g. `Shani & Alpir 1:1`), when looking up notes/tasks, then that person is used for matching. Unknown names are not invented (`לא נמצא בנתונים`).
- [x] Prompt contract: Hugo + `04` mention `prepDate`, Con Action items, DAZ Tasks, and “all people not only שני”.
- [x] Vitest: `prepDate` returns the Shani-linked past note for a tomorrow 1:1; a second person’s note is not dropped when prep day has two meetings.

## Data Model

No schema changes.

## tRPC API

`insights.meetingNotes` (protected): add optional `prepDate: string` (`today` | `tomorrow` | `היום` | `מחר` | YYYY-MM-DD via `resolveLocalDayArg`).

Return stays `{ notes, count }` plus optional `prepFor: { date, meetingTitles: string[] }`.

`get_notion_meeting_notes` tool: add `prepDate`. `get_notion_tasks` unchanged in Notion fetch (already all accounts); tool description names Con Action items and DAZ Tasks.

## UI Surface

No new routes. Agent replies only.

## Out of Scope

- Adding Engineering/Design meeting DBs (no AI-notes structure)
- Syncing per-meeting Notion `child_database` todos as tasks
- Changing assignee filters on `getNotionTasks` (still prefer items assigned to the owner)
- Mobile UI

## Open Questions

None — Con Meetings, DAZ Internal Meetings, and Meetings & Interactions exist in Notion and are added to `NOTION_ACCOUNTS` as `type: meetings`. Con Action items and DAZ Tasks were already `type: tasks`.
