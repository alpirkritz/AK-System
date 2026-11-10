# Waiting list — open and edit a commitment row

> **Slug:** `waiting-commitment-open`
> **Status:** Approved — implemented (see reports/waiting-commitment-open.md)
> **Last Updated:** 2026-11-10
> **Depends on:** `waiting-on-others`, `commitment-source-context`, `calendar-link-and-commitment-task-modal`

## Goal

On "חייבים לי", a row that is an accepted `owner=them` commitment with no task (e.g. one from a voice recording) is plain text. It cannot be opened or edited; the only action is the done tick. Make the title open the regular TaskModal, prefilled from the commitment. Saving creates a task and links it to the commitment, so from then on the row is a normal task that can be edited. Also add the source-context toggle that `waiting-on-others` promised ("Tapping a row opens ... the commitment's source context") but never shipped.

## User stories

- As the owner, I want to click a commitment on "חייבים לי" and edit it (title, due date, project, notes), not just tick it done.
- As the owner, I want the edit form to be the same TaskModal I use everywhere, prefilled with what the system inferred.
- As the owner, I want a saved commitment to turn into a regular task, so it shows up in `/tasks`, syncs to Notion like any task, and opens like any task afterward.
- As the owner, I want to see the original messages or transcript lines a commitment came from, without leaving the list.
- As the owner, I want this to work the same on `/waiting`, on the dashboard card, and on the person drawer.

## Acceptance criteria

**Clickable title**
- [ ] Given a waiting row with `kind='commitment'`, when it renders, then its title is a button (`title="פתח לעריכה"`) with the same hover style as task rows, on all three surfaces: `/waiting`, `WaitingTodayCard`, `PersonDetailDrawer`.
- [ ] Given I click it, then TaskModal opens in create mode. The commitment's `taskPrefill` fills in title, due date, assignee (the person), project and meeting, and shows the existing per-field explanations.
- [ ] Given prefill is still loading, then the modal shows its normal loading state and does not open with an empty title.

**Saving links the task**
- [ ] Given I save the modal, then a task is created through the normal `tasks.create` path (including Notion write-back when the chosen workspace has a linked DB), and `commitments.linkTask` sets the commitment's `taskId` to the new task.
- [ ] Given the link succeeds, then `waiting.list`, `tasks.list` and `commitments` queries are invalidated. The same row now renders as `kind='task'`, and its title opens the task like any other task row. The waiting count does not change, because the commitment is replaced by its task rather than added next to it.
- [ ] Given I close the modal without saving, then nothing is created and the row is unchanged.
- [ ] Given the commitment already has a `taskId`, or is not `accepted`, or is not `owner=them`, then `linkTask` returns `BAD_REQUEST`. The error shows above the list (TaskModal closes as soon as the task is created, so it cannot show the error itself). No second task is linked.
- [ ] Given task creation succeeds but `linkTask` fails, then the error is shown and the created task stays (it is a valid task assigned to the person). The commitment row stays until the user ticks it. This is acceptable and is noted here so no one treats it as a bug.

**Source context**
- [ ] Given a WhatsApp commitment row (`whatsapp_dm` / `whatsapp_group`, the only sources `sourceContext` returns messages for), then a small "הצג הקשר" toggle sits below its secondary line. Other sources, such as voice, get no toggle, because it would always say the messages are gone. It expands the same collapsed context block used on `/commitments`, which lazily calls `commitments.sourceContext`.
- [ ] Given the source messages are gone, then it shows "ההודעות המקוריות כבר לא נשמרות.", the same as `/commitments`.
- [ ] Task rows and non-WhatsApp commitment rows do not get the toggle.

**Unchanged behavior**
- [ ] The done tick still calls `waiting.complete` (commitment becomes `dismissed`, task becomes `done`).
- [ ] Task rows behave exactly as today: `onOpenTask` where provided, otherwise a link to `/tasks?task=<id>`.
- [ ] `/commitments` (proposed commitments) works as today. It uses the extracted shared components, with identical behavior.
- [ ] RTL, dark theme, existing `.btn-ghost` / TaskModal styling; Hebrew copy only in UI.

## Data model

None. `commitments.taskId` already exists in `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`. No migration.

## tRPC API

Router: `packages/api/src/routers/commitments.ts` (existing).

- **`linkTask`** — new, `mutation`, `protectedProcedure`.
  - Input: `z.object({ commitmentId: z.string().min(1), taskId: z.string().min(1) })`.
  - Checks: commitment exists (`NOT_FOUND` otherwise). `status === 'accepted'`, `owner === 'them'` and `taskId IS NULL` (`BAD_REQUEST` with a Hebrew message otherwise). The task exists (`NOT_FOUND` otherwise).
  - Effect: `update commitments set task_id = :taskId, updated_at = now`.
  - Returns `{ ok: true, taskId }`.
  - Why not reuse `accept`: `accept` is limited to `proposed` commitments on purpose, and loosening it would allow re-accepting a dismissed commitment.
- **`taskPrefill`** — existing, reused unchanged. It already works for any status.
- **`sourceContext`** — existing, reused unchanged.
- No change to `waiting.list` or `waiting.complete`. A commitment with `taskId` set already drops out of `waiting.list`, and its task (assigned to the person by TaskModal's prefilled assignee) comes in.

## UI surface

Components (`apps/web/src/components/`):

- **`commitments/CommitmentContext.tsx`** — new. Move the `CommitmentContext` function out of `app/commitments/page.tsx` as is, and add a `compact` prop for the smaller toggle in waiting rows. `/commitments` imports it from here.
- **`commitments/CommitmentTaskModal.tsx`** — new. Wraps TaskModal for one `commitmentId`: runs `commitments.taskPrefill`, loads the people, meetings, projects and workspaces lists the same way `/commitments` does, and calls a supplied `onCreated(task)`. Props: `{ commitmentId: string | null; onClose(); onCreated(taskId: string) }`. `/commitments` switches to it and keeps calling `accept` in `onCreated`. Waiting surfaces call `linkTask` in `onCreated`.
- **`waiting/WaitingList.tsx`** — changed.
  - `WaitingRow` gains an `onOpenCommitment?: (commitmentId: string) => void` prop. With it, a commitment title becomes a button; without it, keep the current behavior (meeting link if `meetingId`, else text).
  - Commitment rows render the `CommitmentContext` toggle.
  - Thread `onOpenCommitment` through `PersonBlocks`, `TodayView` and `WaitingView` the same way `onOpenTask` is threaded today.
- **`waiting/useCommitmentEditor.tsx`** — new small hook plus element. It holds `commitmentId` state, renders `CommitmentTaskModal`, runs `linkTask` and the invalidations, and returns `{ open(id), modal }`. Each surface mounts it once.
- **`waiting/WaitingTodayCard.tsx`** — changed. Mounts the hook and passes `onOpenCommitment`.
- **`people/PersonDetailDrawer.tsx`** — changed. Mounts the hook and passes `onOpenCommitment` to `WaitingView`.

Routes (`apps/web/src/app/`):

- **`waiting/page.tsx`** — changed. Mounts the hook and passes `onOpenCommitment` to `WaitingView`.
- **`commitments/page.tsx`** — changed. Uses the extracted `CommitmentContext` and `CommitmentTaskModal`; no behavior change.

## Tests

- Vitest, `packages/api`: `commitments.linkTask` covers the happy path (an accepted `them` commitment gets linked and drops out of `waiting.list`, and its task appears) and the rejections (already linked, `proposed`, `dismissed`, `owner=me`, missing task).
- Playwright, `apps/web/e2e`: seed an accepted `voice` commitment for a person. On `/waiting`, click its title, then save the modal. The row now opens as a task, and `/tasks?task=<id>` shows it assigned to that person. Also check that the "הצג הקשר" toggle expands.

## Out of scope

- Editing a commitment in place without creating a task. Commitments stay immutable records of what was said.
- Mobile app (`apps/mobile`). It can follow with the same `linkTask` procedure.
- Changing `waiting.list` shape or bucketing.
- Auto-converting all accepted commitments to tasks, or a backfill.
- Rolling back the created task when `linkTask` fails.

## Open questions

- None blocking. One default to confirm: should opening a commitment that came from a meeting (`meeting_analysis` / `voice` with a resolved meeting) still offer a "go to meeting" link? Proposed default: no separate link. The meeting is prefilled in the modal, and once the task is saved it carries `meetingId`.
