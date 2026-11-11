# People — resizable meeting panel

> **Slug:** `people-meeting-panel`
> **Status:** Approved — implemented (see reports/people-meeting-panel.md)
> **Last Updated:** 2026-11-11
> **Depends on:** `waiting-on-others`, `waiting-commitment-open`, `person-portrait`, `person-tasks-sort-open`

## Goal

On `/people`, the person drawer is a fixed 480px modal with a blurred backdrop, and its content is ordered for administration, not for sitting across from someone. Make the panel (1) resizable by drag, (2) open on a "במפגש" view that answers, without scrolling: what do I owe them, what do they owe me, what is committed, and what should I know. Administration moves to its own tab.

## User stories

- As the owner, I want to drag the panel edge to make it wider or narrower, and have it remember my choice.
- As the owner, I want the people list to stay visible beside the panel, so I can switch people without closing it.
- As the owner, opening a person, I want two counts first: what I owe them and what they owe me, with overdue items flagged.
- As the owner, I want to add a task or commitment in one line during the conversation, without a modal.
- As the owner, I want merge, identities, affiliations and meeting history out of the way until I ask for them.

## Definitions (decided)

- **"הם חייבים לי"** — unchanged: `waiting.list({ personId })`. Open tasks assigned to that person, plus accepted `owner = them` commitments with no task.
- **"אני חייב להם"** — **new, no schema change.** Counted **only** when both hold: the task is open (status not `done`/`cancelled`), **I am the assignee** (`tasks.assigneeId = self.id`, via `ensureSelfPerson`), **and the person is linked to it through `task_people`**. That is the owner's rule: "I put the task on me, and the person is the one linked." Nothing else is counted, including commitments (`owner = me`) and tasks with no assignee.
- Tasks assigned to nobody, or to a third person, that merely link this person are **not** counted as owed. They stay under "משימות משותפות".

## Acceptance criteria

**Resize**
- [ ] A drag handle on the panel's inline-start edge (left, since the panel opens from the right in RTL) changes the width live while dragging, using pointer events with pointer capture (mouse and touch).
- [ ] Width is clamped to 380px–75vw.
- [ ] The handle is `role="separator"` `aria-orientation="vertical"` with `aria-valuenow/min/max`, focusable; ArrowLeft/ArrowRight change width by 16px (64px with Shift).
- [ ] Double-click cycles 480 → 760 → full width → 480.
- [ ] The chosen width persists across people and reloads (`userSettings` key, with localStorage as an instant fallback). Default stays 480.
- [ ] At width ≥ 720px, and only while at least 560px of the screen stays free (otherwise the list would be crushed), there is no backdrop and no blur; the list gets `padding-inline-end` equal to the panel width and stays clickable. Clicking another person swaps the panel content, no close/reopen animation. Below 720px the current backdrop behavior is kept.
- [ ] Under 768px viewport: full screen, no handle (as today).
- [ ] Reduced motion: no slide animation.

**Foldable phone (Galaxy Z Fold 7) — closed and open**
- [ ] Closed (cover screen, ~360px wide, tall and narrow): the panel is full screen (`100dvh`), one column, no resize handle. The two summary cards stay side by side (each ≥ 44px tall, text truncates, never wraps the count). The tab bar and the sticky quick-add bar fit without horizontal scroll and respect the safe-area inset at the bottom.
- [ ] Open (inner screen, roughly 880px wide, nearly square): treated as a normal tablet/desktop width. The panel is resizable, side-by-side mode applies (≥ 720px viewport), and the panel layout switches to two columns based on the **panel's own width** (container query at 560px), not the viewport, so a panel dragged narrow stays single column.
- [ ] Folding or unfolding while the panel is open does not close it, loses the draft in the quick-add input, or leaves the panel wider than the viewport (width is re-clamped on `resize`).
- [ ] The stored panel width is ignored below 768px and re-applied (clamped) when the screen opens.
- [ ] Verified at 360×800 (closed) and 880×800 (open), dark theme, RTL.

**Tabs**
- [ ] Three tabs: "במפגש" (default), "פרטים", "היסטוריה". Last used tab is not remembered; each open starts on "במפגש".
- [ ] "פרטים" holds: phone, email, job, tags, affiliations, identities, cadence, merge, edit.
- [ ] "היסטוריה" holds: meetings and meeting summaries (current folded sections).
- [ ] The header keeps only avatar, name, role/company, last-meeting line ("נפגשתם לאחרונה: לפני N ימים · M פגישות"), contact buttons (call, mail, WhatsApp if available), edit, close. The merge button and merge box move to "פרטים".

**"במפגש" tab, top to bottom**
- [ ] Two summary cards: "אני חייב/ת · N" and "חייב/ת לי · N". Each is a button that scrolls to / filters its list. A red dot appears when any item in it is overdue.
- [ ] Open items under the cards, overdue first, then by due date, then no date. Rows reuse `WaitingView` for "חייב/ת לי" and the existing task row for "אני חייב/ת". Clicking a row opens it exactly as today (TaskModal / commitment editor). The done tick works from the row.
- [ ] "משימות משותפות" lists open linked tasks that are in neither list.
- [ ] "חשוב לדעת": up to three lines from the person portrait / context plus the last meeting summary line, from data already loaded (`insights.personContext`, `related.meetingNotes`). No new LLM call.
- [ ] Sticky bottom bar with "+ משימה" and "+ התחייבות" (and "+ הערה" only if a person note field already exists; otherwise omitted).
- [ ] Wide layout (≥ 720px): two columns — owed lists on the inline-start side, "חשוב לדעת" and latest history on the other. Below 720px: one column.

**Quick add**
- [ ] Clicking "+ משימה" shows a one-line input with a direction toggle: "אני חייב/ת" (default) / "חייב/ת לי". Enter saves, Escape cancels, focus returns to the input after saving for the next item.
- [ ] "אני חייב/ת" creates a task assigned to me, linked to the person. "חייב/ת לי" creates a task assigned to the person. Both through the existing `tasks.create`, so Notion write-back is unchanged.
- [ ] "+ התחייבות" creates an accepted commitment with `owner = them` for the person ("חייב/ת לי"). There is no "אני חייב/ת" commitment, because my debts are tasks. The button is a shortcut to the same quick-add with the direction fixed to "חייב/ת לי".
- [ ] Success: the new row appears in its list and the count updates, no toast needed. Error: inline Hebrew message under the input, input keeps its text.
- [ ] Empty title is not submitted; the submit is disabled while pending.

**States**
- [ ] Loading: skeletons for the two cards and rows within 100ms.
- [ ] Empty (both lists): "אין מה לסגור איתו/ה כרגע. אפשר להוסיף משימה או התחייבות." with the quick-add buttons.
- [ ] Error: "לא הצלחנו לטעון את הנתונים. נסו שוב." with a retry button.

**Unchanged**
- [ ] `/people?person=<id>` deep link, merge, edit, PersonAffiliations, reorder of blocks (inside "פרטים" and "היסטוריה"), `/relationships` page.

## Data model changes

None. Existing columns are sufficient: `tasks.assigneeId`, `task_people`, `commitments.owner/status/taskId`. Neither `schema.pg.ts` nor `schema.ts` changes.

User preference for width: reuse the existing `userSettings` key/value mechanism, key `people_panel_width` (number as string). If the table has no generic key/value, fall back to localStorage only and note it in the report.

## tRPC API

- `waiting.owedByMe` (new, query): input `{ personId: string }`. Returns the same `WaitingBuckets` shape as `waiting.list`, built by a new `listOwedByMe(db, { personId })` in `packages/api/src/services/waiting.ts`: tasks where `assigneeId = self.id`, status not done/cancelled, and a `task_people` row for `personId`. Tasks only; no commitments. `WaitingItem.personId` is the other person.
- `waiting.complete` already handles both kinds; reused unchanged for ticking owed items.
- `commitments.create` (or the existing manual-add procedure): confirm during implementation that it accepts `owner: 'me' | 'them'`, `personId`, `status: 'accepted'`. If not, add the minimal input.
- No change to `people.getById/getRelated`.

## UI surface

Files: `apps/web/src/components/people/PersonDetailDrawer.tsx` (split into `PersonPanel` shell + `PersonMeetingTab`, `PersonDetailsTab`, `PersonHistoryTab`), new `useResizablePanel` hook, `apps/web/src/app/people/page.tsx` (list padding in side-by-side mode), `apps/web/src/app/globals.css` (`.drawer` width from CSS variable `--panel-width`, drag handle styles). Design-system classes only (`.btn`, `.input`, `.card`, `.pill`, `.icon-btn`); RTL, dark theme, gold `#e8c547` accent on the handle's hover/focus. Touch targets ≥ 44px for the two cards, the tabs and the quick-add buttons. No new UI library.

Microcopy (Hebrew): "אני חייב/ת", "חייב/ת לי", "משימות משותפות", "חשוב לדעת", "+ משימה", "+ התחייבות", "הוסף", "פרטים", "היסטוריה", "במפגש".

## Out of scope

- An explicit direction field on tasks (`owedBy`) — rejected for now; revisit if the "assigned to me + linked" rule gives wrong counts.
- Changes to the mobile app (`apps/mobile`).
- Bulk actions, merging flow changes, the people table/grid.
- Generating a new AI "talking points" summary.

## Open questions

- Is there a person-level free-text note field to power "+ הערה", or should it be left out of v1?
- (Resolved) "אני חייב/ת" counts only tasks assigned to me and linked to the person. Anything else is not counted.
