# Open any task row, smarter defaults for new tasks

## Goal
Every task shown in a list should open its edit modal when clicked, and a new task should arrive pre-filled with the context it was created from (project, world) and today's date.

## User stories
- On a person's card, under "חייב/ת לי", I click a task and it opens, the same way the other related tasks do.
- From the /waiting page, clicking a task opens it.
- When I add a task from a meeting that belongs to a project or a world, the task already has that project and world.
- When I add a task from a project page, the task already has the project's world.
- A new task is due today by default, and I can move the date a day back or forward with arrows.

## Acceptance criteria
1. `WaitingRow` renders a task (kind `task`) title as a button that opens the task. The person drawer opens its own `TaskModal`; elsewhere the row links to `/tasks?task=<id>`. Commitments keep their current behaviour (meeting link or plain text).
2. `/tasks?task=<id>` opens the edit modal for that task; closing it removes the param.
3. `TaskModal` in create mode defaults:
   - `projectId`: the `projectId` prop, else the meeting's project.
   - `workspaceId`: the `workspaceId` prop, else the meeting's world, else the default project's world.
   - `dueDate`: `initialValues.dueDate`, else today (local day).
4. Next to the due-date input, two arrow buttons move the date by one day (previous on the right, next on the left, RTL). With an empty date they start from today.
5. Editing an existing task is unchanged apart from the arrows.
6. Person card: the "הושלמו" and "בוטלו" task groups start folded with a count; their rows are not rendered until opened. Open/closed is saved once for all people (layout `person` screen, ids `tasks/done`, `tasks/cancelled`), not per person.
7. Person card: the "פגישות" block starts folded; opening or closing it is saved once for all people with the layout (`BlockState`), and rows are not rendered while folded. Meeting rows link to `/meetings/<id>`.
8. Person card: the whole "משימות" block can fold (open by default) and "סיכומי ישיבות" folds (closed by default); both saved once for all people, rows not rendered while folded.
9. Block reordering ("סדר מחדש") already lives in the person card (spec `layout-reorder`); the People list is unchanged.

## Data model
None.

## tRPC API
None. Uses existing `meetings.getById` (returns `workspaceId`, `projectId`) and `projects.list` (returns `workspaceId`).

## UI surface
`components/Modals/TaskModal.tsx`, `components/waiting/WaitingList.tsx`, `components/people/PersonDetailDrawer.tsx` (tasks/meetings folding), `app/tasks/page.tsx`, helper `shiftDayKey` in `lib/task-due.ts`.

## Out of scope
Quick-add modal (header "+") keeps its no-date default; mobile app.
