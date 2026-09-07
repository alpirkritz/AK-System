# Conversation Analysis Task Created State

> **Slug:** `conversation-analysis-task-created-state`
> **Status:** Draft
> **Last Updated:** 2026-09-07

## Goal

Persist the task ID when creating a task from a conversation-analysis action item, and display "משימה נוצרה" instead of "צור משימה" to give visual confirmation that the task already exists.

## User Stories

- As a user, when I create a task from an action item in conversation analysis, I want the button to show "משימה נוצרה" so that I know the task has been created and I don't accidentally create duplicates.

- As a user, I want the batch "צור הכל" flow to also persist task IDs so that both single-create and batch-create show consistent state.

## Acceptance Criteria

- [ ] After clicking "צור משימה" and saving a task from the TaskModal, the button changes to show "משימה נוצרה" (disabled, teal/success styling)
- [ ] After using "צור הכל" to batch-create tasks, all created action items show "משימה נוצרה"
- [ ] Refreshing the meeting detail page preserves the "משימה נוצרה" state (taskId persisted in database)
- [ ] Action items that already have a taskId continue to show "✓ נוצר" (existing behavior unchanged)
- [ ] Mobile app is not affected (it navigates to /task/new, different flow)
- [ ] API endpoint validates analysisId and actionItemIndex, returning errors for invalid inputs

## Data Model

**No schema changes required.** The `meeting_analyses.actionItemsJson` field already supports `taskId` on each action item. This change writes the taskId that was previously left empty when creating tasks via TaskModal.

## tRPC API

Add to `packages/api/src/routers/meetings.ts`:

### `meetings.linkActionItemTasks`

- **Type:** `protectedProcedure` + `mutation`
- **Input:** 
  ```typescript
  z.object({
    analysisId: z.string().min(1),
    links: z.array(z.object({
      actionItemIndex: z.number(),
      taskId: z.string().min(1)
    }))
  })
  ```
- **Return:** `{ linked: number }` (count of successfully linked items)
- **Logic:**
  1. Fetch `meeting_analyses` row by `analysisId`
  2. Parse `actionItemsJson` to array
  3. For each link in `links`:
     - Validate `actionItemIndex` is within bounds
     - Set `actionItems[actionItemIndex].taskId = taskId` (skip if already set to same ID)
  4. Stringify and update `actionItemsJson`
  5. Set `updatedAt` to current timestamp
  6. Return count of items successfully linked

### Extend `onCreated` callback in TaskModal

- TaskModal's `onCreated` callback currently receives `notionSync: { ok: boolean } | null`
- Extend to also receive the created task object `{ id: string, ... }` as second parameter
- Callers in `apps/web/src/app/tasks/page.tsx` and `DashboardLayout.tsx` already ignore extra args, so no breaking change

## UI Surface

### `apps/web/src/app/meetings/components/ConversationAnalysis.tsx`

**Changes:**
- Replace `✓ נוצר` text span with a disabled button/badge labeled "משימה נוצרה"
- In `handleTaskCreated`: capture the created task ID from `onCreated` callback, call `meetings.linkActionItemTasks.mutate({ analysisId, links: [{ actionItemIndex: selectedActionIndex, taskId }] })`, then refetch analysis
- Ensure `selectedActionIndex` is captured before calling `onCreated` (TaskModal closes immediately)

### `apps/web/src/components/Modals/TaskModal.tsx`

**Changes:**
- Extend `onCreated` callback signature from `(notionSync) => void` to `(notionSync, task?) => void`
- Pass the created task object as second argument when calling `onCreated` in the `create.mutate` success handler

### `apps/web/src/components/Modals/BatchTaskModal.tsx`

**Changes:**
- After creating all tasks, call `meetings.linkActionItemTasks.mutate` with all `createdTaskIds` collected during the loop
- Add `utils.meetings.getAnalysis.invalidate()` after successful link

## Out of Scope

- Mobile app (`apps/mobile/components/ConversationAnalysis.tsx`) — different flow (navigates to `/task/new`, no modal)
- Changing the existing "צור הכל" button label (stays as-is)
- Auto-linking tasks created outside the conversation-analysis flow (e.g., manually created task that happens to match an action item)
- Retroactive linking for old analyses that used `meetings.createTasksFromAnalysis` (those already have taskId set)

## Open Questions

None — implementation is straightforward.
