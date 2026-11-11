# Waiting on others — who owes me what

> **Slug:** `waiting-on-others`
> **Status:** Approved — in progress (see reports/waiting-on-others.md)
> **Last Updated:** 2026-11-01
> **Depends on:** `person-aliases`

## Goal

Tasks and commitments from meetings and chats often belong to someone else. `/tasks` hides them behind "שלי", so the owner cannot see at a glance what others owe him. One data source, three surfaces, all answering "מי חייב לי מה": a dedicated page (like התחייבויות), a "היום" digest on the dashboard, and a tasks-first section on each person's page. No outbound messages; the owner follows up himself.

## User Stories

- As the owner, I want a dedicated page, next to התחייבויות, listing what everyone owes me.
- As the owner, I want its first view to be "today": who owes me what right now.
- As the owner, I want the same list grouped by person, and a flat list by date.
- As the owner, I want to open a person (e.g. ולרי) and see their tasks first, before anything else.
- As the owner, I want this for everyone I know, with no list to maintain.
- As the owner, I want to tick something off when the person delivered.

## Acceptance Criteria

**Shared data**
- [ ] An item is an open task whose `assigneeId` is set and is not `people.me`, or an accepted `owner=them` commitment with no task. Tasks with no assignee and tasks assigned to the owner never appear.
- [ ] Rows read "<title>" first, with person, due date and source (meeting, WhatsApp, email, voice) as secondary text. Counts appear only as small badges.
- [ ] Tapping a row opens the task or the commitment's source context. A done button marks the task done (or the commitment closed) and removes the row.

**Page `/waiting` ("חייבים לי")**
- [ ] Nav entry beside התחייבויות on web; a tab or screen entry on mobile.
- [ ] Three views as chips, default "היום":
  - **היום** — what is due today plus overdue, grouped by person. This is "מי חייב לי מה היום".
  - **לפי אדם** — every open item, one block per person, people with overdue or today items first.
  - **לפי זמן** — flat list in sections: באיחור, להיום, השבוע, אחר כך, בלי תאריך.
- [ ] A person chip filter narrows any view to one person.
- [ ] Empty "היום" shows "אף אחד לא חייב לך משהו להיום" with a link to the other views.

**Dashboard**
- [ ] A compact card "חייבים לי היום" shows the "היום" view (up to 5 rows) and a "לכל הרשימה" link to `/waiting`. Hidden when empty.

**Person page**
- [ ] On the person page, a **"משימות"** section is the first block, above אופי, the recommendation and everything else in `PersonContextCard`.
- [ ] It has two parts: "חייב/ת לי" (open tasks and commitments assigned to this person, overdue and today first) and "אני חייב/ת" (my open tasks linked to this person through `taskPeople`, and meeting open loops, absorbing the current "משימות פתוחות" block).
- [ ] The commitments-to-confirm block stays where it is but moves right below this section.
- [ ] The section is always shown; when empty it says "אין משימות פתוחות".

**Other**
- [ ] `/tasks` gains a third chip "ממתין לאחרים"; "שלי" and "כולם" are unchanged.
- [ ] Tasks created from a meeting action item or an `owner=them` commitment get that person as `assigneeId`, resolved through `resolvePerson`.
- [ ] Hugo's morning briefing adds one line of today's and overdue items by title and person.
- [ ] RTL, dark theme, existing `.card` and chip classes.

## Data Model

None. Optionally an index on `tasks(assignee_id, done, due_date)` if the query is slow.

## tRPC API

- `waiting.list({ personId?, view })` → items shaped `{ kind: 'task' | 'commitment', id, title, person, dueDate, source, sourceContext }`, already bucketed. Single source for the page, the dashboard card, the person section and the briefing.
- `waiting.complete({ kind, id })`.
- Person section reuses `waiting.list({ personId })` plus the existing mine-linked-to-person data from `insights.personContext`.

## UI Surface

- New `apps/web/src/app/waiting/page.tsx`; nav item in `components/DashboardLayout.tsx` beside התחייבויות.
- `apps/web/src/app/page.tsx`: dashboard card.
- `apps/web/src/components/people/PersonContextCard.tsx`: new first section; update the order in the header comment.
- `apps/web/src/app/tasks/page.tsx`: third chip.
- Mobile: matching screen, home card and person screen section.
- Morning briefing context (`lib/morning-briefing-context.ts`).

## Out of scope

Sending reminders; per-person opt-in lists; push notifications for others' tasks.

## Open questions

- Does today's pipeline set `assigneeId` when an `owner=them` commitment becomes a task? To be verified before implementation.
