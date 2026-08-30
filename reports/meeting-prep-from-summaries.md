# Code Review: Meeting prep from summaries

> **Slug:** `meeting-prep-from-summaries`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-08-30

## Spec Conformance

`insights.meetingNotes` accepts `prepDate` and returns prior-60-day summaries for everyone on that day's local calendar (title / known CRM person / `meeting_people` / `meeting_note_people`). Day-prep ignores a leftover person `query` so Hugo cannot drop the rest of the day after a שני filter. Named-person asks still use `query` without `prepDate`. Hugo + `04` prompts name `prepDate`, Con Action items, DAZ Tasks, and all people — not only שני. `get_notion_tasks` fetch was already all task DBs; descriptions now say so.

## Static Checks

| Check | Result |
|---|---|
| Targeted Vitest (`insights.meeting-notes`, conversation-engine meeting-notes, calendar-brief prompts) | PASS (10 + 5 + 8) |
| `pnpm -r run lint` | Not re-run this pass |
| `pnpm --filter @ak-system/web build` | Not re-run this pass |

## Findings

### Must-fix

None.

### Should-fix

None.

### Nits

- Hebrew↔English aliases in `person-name-match.ts` still only cover שני/Shani. Other people match when the CRM name (or a 4+ char token) appears in the calendar/note title.
- Full lint/build not re-run; no UI surface in this change.

## Out of Scope Creep

None. DAZ Meetings DB, child_database todos, and assignee-filter changes were not touched.

## Suggested PR Description

Day-wide meeting prep now loads prior AI summaries for every person on the calendar (not only Shani), and briefs related tasks from DT / Con / DAZ action DBs in the same shape.
