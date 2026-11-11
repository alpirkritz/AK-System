# Meeting prep — isolate by topic, not by who was in the room

> **Slug:** `meeting-prep-topic-isolation`
> **Status:** Approved
> **Last Updated:** 2026-10-06

## Goal

A 15-minute pre-meeting brief for one calendar event must use only notes and tasks about **that meeting's topic**. Shared attendees are not relevance.

Today `insights.meetingNotes` with `prepDate` keeps a note when it shares a person with anyone in that day's meetings (`noteMatchesPrepMeeting` via `prepPersonNoteIds` and `titlesShareKnownPerson` in `packages/api/src/routers/insights.ts`). The same people sit in "Follow up DD release discussion" and in "Algo 4.0 - Sync meeting updates", so Algo summaries and Algo tasks are written into the DD walk-in card ("מאז הפעם הקודמת" cites Algo 4 meetings; "פתוח" lists an Algo 4.0 task).

Day-wide prep ("תכין אותי למחר" / morning briefing) stays as it is: every meeting that day, matched by people and titles. This change applies only when the run is about **one named meeting**.

## User Stories

- As the owner, before a DD release meeting I want the brief to ignore Algo 4 notes and tasks, even when the same people were in both rooms.
- As the owner, when there is no earlier note on this topic, I want `אין סיכום מהפגישה הקודמת` rather than the last meeting those people had.
- As the owner, a day-wide "prepare me for tomorrow" brief should still include each meeting's own prior notes.

## Acceptance Criteria

- [ ] `topicTokens("Follow up DD release discussion")` contains `dd` and does not contain `follow`, `release`, or `discussion`.
- [ ] `topicTokens("Algo 4.0 - Sync meeting updates")` contains `algo` and does not contain `sync`, `meeting`, `updates`, or a bare `4` / `4.0`.
- [ ] `titlesShareTopic` is true for "Follow up DD release discussion" and "DD sync", and false for that title against "Algo 4 Milestones timelines" and against "Algo 4.0 - Sync meeting updates".
- [ ] `insights.meetingNotes` with `focusTitle: "Follow up DD release discussion"` returns a note titled "DD release sync" and drops a note titled "Algo 4.0 - Sync meeting updates" even when both notes are linked to the same person who is on today's DD meeting.
- [ ] The same Algo note is still returned by `meetingNotes({ prepDate })` **without** `focusTitle` (existing day-wide person matching stays).
- [ ] A note that does not share a topic token is still returned for that `focusTitle` when it is linked (via `meetingNoteProjects` or its meeting's `projectId`) to the same project as a meeting whose title shares the topic, or when its meeting's `seriesId` equals that meeting's `seriesId`.
- [ ] `selectRelatedOpenTasks` for title "Follow up DD release discussion" excludes "Ensure QA monitoring is in place and confirm readiness for Algo 4.0" and excludes "Provide deliverable to Jordan (with Adam) based on Elad discussion". It includes a task whose title contains `DD` or that shares the linked meeting's `projectId`.
- [ ] `findPriorMeetingNotes` returns the newest past note whose title shares a topic token (not only an exact title). It returns null when the only past notes are another topic.
- [ ] On a `04_meeting_prep_herald` run whose prompt contains exactly one `Meeting: …` line, `get_notion_meeting_notes` and `get_notion_tasks` are called with that line's title as `focusTitle` even if the model omitted it. A prompt with zero or two-or-more `Meeting:` lines does not inject `focusTitle`.
- [ ] With `focusTitle` set, `get_notion_tasks` results include only tasks whose title shares a topic token with that title (Notion task objects have no local `projectId`; project match applies only to local tasks in `selectRelatedOpenTasks`).
- [ ] Walk-in card rule: "מאז הפגישה הקודמת" may cite only a note that survived the focus filter. If none did, the line is `אין סיכום מהפגישה הקודמת`. שורה תחתונה must not name a second product that is absent from the focused notes and from the meeting title.
- [ ] Existing `prepDate` tests in `packages/api/src/routers/insights.meeting-notes.test.ts` still pass.

## Data Model

No schema changes. `packages/database/src/schema.ts` and `schema.pg.ts` stay as they are.

Relevance uses columns that already exist:

- `meetings.title`, `meetings.projectId`, `meetings.seriesId`
- `meetingNotes.title`, `meetingNotes.meetingId`
- `meetingNoteProjects.projectId`
- `tasks.title`, `tasks.projectId` (local tasks only)

## tRPC API

Extend `insights.meetingNotes` (`protectedProcedure`, router `insights` in `packages/api/src/routers/insights.ts`).

Add to `meetingNotesInput`:

```ts
focusTitle: z.string().min(1).optional()
```

Auth stays `protectedProcedure`. No new procedure.

When `focusTitle` is set, after the current load:

1. Resolve anchor meetings: rows in `meetings` whose `titlesShareTopic(title, focusTitle)` is true (any date, not only the prep day).
2. From those anchors, collect `projectId` and `seriesId` (ignore nulls).
3. Keep a note only if one of these is true:
   - `titlesShareTopic(note.title, focusTitle)` or `titlesShareTopic(note.meetingTitle, focusTitle)`
   - `note.meetingId` points at a meeting with one of the anchor `seriesId`s
   - the note's meeting `projectId`, or a `meetingNoteProjects` row, is one of the anchor `projectId`s
4. Do **not** keep a note only because `prepPersonNoteIds` contains it or `titlesShareKnownPerson` is true.
5. `prepDate` may still be passed (the model does this today). It narrows the candidate set as now; `focusTitle` then removes other topics. It must not re-expand via people.

When `focusTitle` is omitted, `noteMatchesPrepMeeting` is unchanged.

### Topic tokens

New module `packages/api/src/lib/topic-match.ts`, exported from `packages/api/src/index.ts`:

- `topicTokens(title: string): string[]`
- `titlesShareTopic(a: string, b: string): boolean` — true when the token sets intersect.

Rules:

- Lowercase, strip punctuation, split on whitespace.
- Drop stopwords, including the current `TITLE_STOP` set in `apps/web/src/lib/pre-meeting-brief.ts` plus: `release`, `discussion`, `update`, `updates`, `milestone`, `milestones`, `timeline`, `timelines`, `status`, `review`, `prep`, `followup`, and Hebrew generics `פגישה`, `עדכון`, `סטטוס`, `שחרור`, `דיון`, `סנכרון`.
- Drop bare numbers and version fragments (`4`, `4.0`, `v2`). "Algo 4" and "Algo 4.0" match because both yield `algo`.
- Keep a token of length ≥ 4, or a token of length 2–3 that was all-caps in the original title (`DD`). Do not keep ordinary short words.
- `apps/web/src/lib/pre-meeting-brief.ts` `significantTitleTokens` delegates to `topicTokens` so the cron hint and the API use one definition.

## UI Surface

No page, component, or style change.

The user-visible surface is the pre-meeting message already sent by `apps/web/src/app/api/cron/pre-meeting-briefing/route.ts` (WhatsApp / Telegram / ARO push). Same text the Meeting Prep Herald writes today; only its sources change.

`buildPreMeetingAgentContext` keeps the single line `Meeting: ${event.title}`. That line is the injection signal. Do not add a second `Meeting:` line.

## Implementation notes

1. **Filter in the API**, not only in the prompt. `A_Agents/04_meeting_prep_herald.md` already says "related only"; the model still fills the card from whatever notes the tool returned.
2. **`apps/web/src/lib/conversation-engine.ts`**
   - Add optional `focusTitle` to the `get_notion_meeting_notes` tool schema and pass it to `caller.insights.meetingNotes`.
   - On `get_notion_tasks`, when `focusTitle` is present, drop tasks whose title does not `titlesShareTopic` with it. Apply to every bucket (`overdue`, `today`, `soon`, `highPriority`, and the tomorrow list).
   - Tool description: for one named meeting pass `focusTitle` (the calendar title). For day-wide prep pass `prepDate` and omit `focusTitle`.
3. **`apps/web/src/lib/gemini-agent-engine.ts`**
   - Before executing tools for `04_meeting_prep_herald`, if the user message has exactly one `/^Meeting:\s+(.+)$/m` capture, set `focusTitle` on `get_notion_meeting_notes` and `get_notion_tasks` calls that omitted it. Do not override a `focusTitle` the model already sent.
   - In `getMeetingPrepNotionParityOverride`, add: a prior meeting is the previous instance of this topic only; shared attendees are not enough; if the tool returns no on-topic note, write `אין סיכום מהפגישה הקודמת` and do not name another product in שורה תחתונה.
4. **`apps/web/src/lib/pre-meeting-brief.ts`**
   - `selectRelatedOpenTasks` matches on `titlesShareTopic(task.title, meetingTitle)`, or `task.meetingId === linked.id`, or `task.projectId === linked.projectId`. Token overlap uses `topicTokens`, so `release` no longer matches and `DD` does.
   - `findPriorMeetingNotes` matches `titlesShareTopic` instead of normalized full-title equality, still requiring `date < todayIso` and useful notes. Newest date wins.
5. **`A_Agents/04_meeting_prep_herald.md`** — one paragraph under the grounding rule: same-topic or same project/series only; person overlap is not a match; empty prior section uses `אין סיכום מהפגישה הקודמת`. Mirror one line in `S_Skills/wf_meeting_prep.md` Stage 2. The markdown is not the enforcement.

## Out of Scope

- Changing day-wide `prepDate` behavior when `focusTitle` is absent (morning briefing, "תכין אותי ליום").
- An alias table (`DD` ↔ `Dragon Drive`). Titles that do not share a token match only through an existing `projectId` or `seriesId` on the linked meeting. Unlinked "Dragon Drive" notes do not appear on a meeting titled only "DD".
- Auto-linking a Google Calendar event to a project or series.
- Notion sync, task creation, or the walk-in card section layout.
- Filtering `get_notion_people` / `get_notion_projects` / `get_notion_companies`.

## Open Questions

None. Alias expansion and calendar-to-project linking are follow-ups, not blockers for this filter.
