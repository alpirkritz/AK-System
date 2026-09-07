# Spec — Notion field writeback (tasks: title/priority/due date; meetings: title/date/time)

> **Slug:** `notion-date-writeback`
> **Status:** Draft
> **Last Updated:** 2026-09-07
> **Extends:** `notion-writeback-and-mobile-tasks.md` (status writeback)

## Goal

Extend Notion writeback beyond status to cover title, priority, and due date for tasks, and title/date/time for meetings. Today these fields are written to Notion only at creation time; editing them locally never reaches Notion, and the next pull-sync can overwrite local changes with stale Notion values. This spec makes every user edit visible in Notion immediately, with the same local-first contract as status writeback.

## User Stories

- As a user, I want task title changes to appear in Notion so my colleagues see the updated title without manual duplication.
- As a user, I want to set or change a task due date and have it sync to Notion so filtered Notion views show the correct deadlines.
- As a user, I want to change task priority and see it reflected in Notion so the team can triage correctly.
- As a user, I want to add a date to a "פגישות ללא תאריך" meeting and have it stick in Notion so the meeting no longer appears undated on the next sync.
- As a user, I want meeting title and date changes to write back to Notion so the Notion meetings database stays current.

## Acceptance Criteria

### Tasks

- [ ] Editing a Notion-sourced task's title PATCHes the title property to Notion (when `source === 'notion'` and `notionPageId` exists).
- [ ] Editing priority PATCHes the priority select/status using `pickPriorityLabel` (`high` → `High`, not `Critical` in a Critical/High/Medium/Low database).
- [ ] Editing due date PATCHes the date property; clearing the date sends `{ date: null }`.
- [ ] All changed fields (title, priority, due date, status) are sent in **one PATCH** when multiple fields change in the same save.
- [ ] Unchanged fields are **not** included in the PATCH; a save with no real changes does not call Notion.
- [ ] When a priority or date property is missing from the database, that field is silently omitted from the PATCH; title and status still write.
- [ ] The local row updates immediately even if Notion returns 500; `notionSync` reports the failure.
- [ ] `tasks.create` behavior is unchanged (already writes all fields at creation).

### Meetings

- [ ] Editing a meeting with `notionPageId` PATCHes changed title, date, and time to the linked Meetings-DB page.
- [ ] Title writes to the `Subject` property (title or rich_text type) when present; else the database `title` property.
- [ ] Date + time are combined into an ISO local datetime with `Asia/Jerusalem` offset.
- [ ] A save that changes only title (not date) still PATCHes; a save that changes only date (not title) still PATCHes.
- [ ] The sentinel date `9999-12-31` is **not** written to Notion; date field is omitted from PATCH if local date is the sentinel.
- [ ] Meetings without `notionPageId` (manual or calendar-only) skip Notion writeback entirely.
- [ ] Failed writeback returns `notionSync` but the local row still commits.

### Pull-sync guard

- [ ] Graph-sync does **not** overwrite a real local meeting date with `9999-12-31` from Notion (applies only when local date is not the sentinel).
- [ ] Graph-sync still attaches `notionPageId` / `projectId` when linking the meeting to a Notion page.
- [ ] A real Notion date continues to overwrite local (Notion wins when Notion has data).
- [ ] Calendar-linked meetings keep their existing title/date guard unchanged.

### UI

- [ ] TaskModal Notion hint reads "מסונכרן עם Notion — שינוי כותרת, סטטוס, עדיפות או תאריך יעד יעודכן גם שם".
- [ ] MeetingModal shows a Notion hint when `notionPageId` exists, mentioning title and date.
- [ ] Failed `notionSync` on task edit surfaces the same way as on create (existing inline error pattern).
- [ ] Failed `notionSync` on meeting save shows "הפגישה נשמרה, אבל העדכון ל-Notion נכשל"; modal still closes.
- [ ] Mobile task form Notion hint widens to match web.

## Data Model

**No schema changes.** Tasks already have `source`, `notionPageId`, `notionAccount`, `notionDb`; meetings already have `notionPageId`. Writeback uses existing columns.

## tRPC API

### Extended procedures

#### `tasks.update` (`packages/api/src/routers/tasks.ts`)

**Input:** existing `updateInput` (unchanged)

**Return type extension:**
```typescript
{ ...TaskRow, notionSync: WriteBackResult | null }
```

**Behavior change:**
- Read the task row **before** applying local updates.
- After local commit, when `source === 'notion'` and `notionPageId` exists:
  - Compare new vs old: `title`, `priority`, `dueDate`, `status`.
  - Call `pushTaskProperties` with only changed fields.
  - Return `notionSync` result.

#### `meetings.update` (`packages/api/src/routers/meetings.ts`)

**Input:** existing `updateInput` (unchanged)

**Return type extension:**
```typescript
{ ...MeetingRow, notionSync: WriteBackResult | null }
```

**Behavior change:**
- Read the meeting row **before** applying local updates.
- After local commit, when `notionPageId` exists:
  - Compare new vs old: `title`, `date`, `time`.
  - Call `pushMeetingProperties` with changed fields.
  - Return `notionSync` result.

### New service functions

#### `packages/api/src/services/notion-task-writeback.ts`

**New export:**
```typescript
function pushTaskProperties(input: {
  notionPageId: string
  notionAccount: string | null | undefined
  notionDb: string | null | undefined
  title?: string
  priority?: 'high' | 'medium' | 'low'
  dueDate?: string | null  // null means clear
  status?: CanonicalStatus
}): Promise<WriteBackResult>
```

Fetches cached schema, builds properties object, sends one PATCH. Returns `{ ok: false }` only when page/account cannot be resolved, PATCH fails, or **none** of the requested fields could be written.

**Refactor:** `pushTaskStatus` becomes a thin wrapper calling `pushTaskProperties({ status })`.

#### `packages/api/src/services/notion-meeting-writeback.ts` (new file)

```typescript
export type MeetingWriteBackResult =
  | { ok: true; wrote: string[] }  // field names successfully written
  | { ok: false; reason: WriteBackFailure; message?: string }

export async function pushMeetingProperties(input: {
  notionPageId: string
  title?: string
  date?: string  // YYYY-MM-DD
  time?: string  // HH:MM
}): Promise<MeetingWriteBackResult>
```

1. Resolve token by trying each unique token from `resolveDatabases('meetings')` until `GET /v1/pages/{id}` succeeds.
2. Read `parent.database_id`, fetch schema.
3. Build properties:
   - Title → `Subject` property (title or rich_text type) if present; else database `title` property. Skip empty.
   - Date+time → prefer property names matching `/date|due|start|when|תאריך/i`, else first `date` type. Format as ISO local datetime with `Asia/Jerusalem` offset. Skip if date is `9999-12-31` or empty.
4. PATCH, never throw. Return fields written or failure reason.

## UI Surface

### Web

**No new routes.** Extend existing modals:

- **`apps/web/src/components/Modals/TaskModal.tsx`**
  - Line ~357: hint text becomes "מסונכרן עם Notion — שינוי כותרת, סטטוס, עדיפות או תאריך יעד יעודכן גם שם".
  - On `update` success with `notionSync?.ok === false`: show inline error the same way `create` does today.

- **`apps/web/src/components/Modals/MeetingModal.tsx`**
  - After form, if `meeting?.notionPageId`: show hint "מסונכרן עם Notion — שינוי כותרת או תאריך יעודכן גם שם".
  - On `update` success with `notionSync?.ok === false`: show "הפגישה נשמרה, אבל העדכון ל-Notion נכשל" inline, then close modal after 1.2s (same timeout pattern as mobile task save).

### Mobile

**No new screens.**

- **`apps/mobile/app/task/[id].tsx`**
  - Line ~227–237 error block: widen hint to match web ("שינוי כותרת, סטטוס, עדיפות או תאריך יעד").

## Out of Scope

- **Assignee writeback on update.** Create already pushes assignee; extending update is deferred.
- **Google/Apple calendar writeback.** Calendar events stay read-only from the calendar APIs.
- **Meeting-note writeback.** `meeting_notes` pages are ingested but not written.
- **Creating Notion meeting pages from local-only meetings.** Only meetings with existing `notionPageId` write back.
- **Writing sentinel `9999-12-31` into Notion.** Sentinel dates are a local-only marker for "no date."
- **Meeting priority.** Meetings databases have no priority field.
- **Real-time Notion webhooks.** Still pull-based sync.

## Open Questions

None. The implementation path is clear: extend existing writeback service, add meeting writeback service, wire routers, guard graph-sync, update hints.

## Implementation Notes

### Task writeback extension

Reuse `packages/api/src/services/notion-task-writeback.ts`. The cached `DatabaseSchema` already has:
- `titlePropertyName` (first `title`-type property)
- `datePropertyName` (first `date`-type property)
- `priority: PrioritySchema | null` (first select/status matching priority pattern)
- `status: StatusSchema | null`

New `pushTaskProperties` function:
1. Fetch schema (cached).
2. Build properties object from provided fields:
   - Title: `{ title: [{ text: { content } }] }`. Skip if empty.
   - Priority: `pickPriorityLabel(priority, schema.priority.options)` → `{ select/status: { name } }`. Skip if no label maps.
   - Due date: `{ date: { start } }` or `{ date: null }`. Skip if no date property.
   - Status: existing `pickNotionLabel` → `{ select/status: { name } }`.
3. PATCH `https://api.notion.com/v1/pages/{notionPageId}` with built properties.
4. Return `{ ok: true, label }` (status label for backward compat) or `{ ok: false, reason, message }`.

`pushTaskStatus` becomes:
```typescript
export async function pushTaskStatus(input: { ... }): Promise<WriteBackResult> {
  return pushTaskProperties({
    notionPageId: input.notionPageId,
    notionAccount: input.notionAccount,
    notionDb: input.notionDb,
    status: input.status,
  })
}
```

### Meeting writeback

New file `packages/api/src/services/notion-meeting-writeback.ts`:

1. **Token resolution:** Meetings don't store `notionAccount`/`notionDb`, so try each unique token from `resolveDatabases('meetings')` until `GET /v1/pages/{notionPageId}` succeeds (status 200). Cache the mapping in-module.
2. **Schema fetch:** Read `parent.database_id` from page object, fetch `GET /v1/databases/{databaseId}`, cache schema.
3. **Property mapping:**
   - **Title:** Look for `Subject` or `subject` property first (matches read path `getPageTitle`). Write as `{ title: [...] }` if type is `title`, or `{ rich_text: [...] }` if type is `rich_text`. Fall back to database `title` property.
   - **Date:** Prefer names matching `/date|due|start|when|תאריך/i`, else first `date` type. Combine `date` (YYYY-MM-DD) and `time` (HH:MM) into ISO local datetime: `YYYY-MM-DDTHH:MM:SS+03:00` (use `TIMEZONE` env, default `Asia/Jerusalem`). Helper: `localDateTimeToIso(date, time, timezone)`.
4. **PATCH:** Send properties, return `{ ok: true, wrote: ['title', 'date'] }` or `{ ok: false, reason }`.

### Graph-sync guard

In `packages/api/src/services/notion-graph-sync.ts`, when updating an existing meeting linked to Notion (~line 526–551):

```typescript
if (id) {
  const existing = existingMeetings.find((m) => m.id === id)
  const attachingToCalendar = Boolean(existing && !existing.notionPageId)
  const patch: { ... } = { notionPageId: page.id, updatedAt: now }
  
  if (projectId) patch.projectId = projectId
  
  if (attachingToCalendar) {
    // Keep calendar title/date
    if (existing && /\d{4}-\d{2}-\d{2}T/.test(existing.title)) {
      patch.title = title
    }
  } else {
    // Notion meeting update
    const notionHasNoDate = (date === '9999-12-31')
    const localHasRealDate = existing && existing.date && existing.date !== '9999-12-31'
    
    patch.title = title
    
    // Guard: do not wipe a real local date with Notion's empty sentinel
    if (!(notionHasNoDate && localHasRealDate)) {
      patch.date = date
      patch.time = time
    }
  }
  
  await db.update(meetings).set(patch).where(eq(meetings.id, id))
}
```

### Router integration

**`packages/api/src/routers/tasks.ts` `update` mutation:**

```typescript
update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
  const { id, ...rest } = input
  
  // Read old row for comparison
  const [oldRow] = await ctx.db.select().from(tasks).where(eq(tasks.id, id))
  
  // Apply local update (existing logic unchanged)
  const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (rest.title !== undefined) updates.title = rest.title
  if (rest.meetingId !== undefined) updates.meetingId = rest.meetingId
  if (rest.projectId !== undefined) updates.projectId = rest.projectId
  if (rest.workspaceId !== undefined) updates.workspaceId = rest.workspaceId
  if (rest.assigneeId !== undefined) updates.assigneeId = rest.assigneeId
  if (rest.dueDate !== undefined) updates.dueDate = rest.dueDate
  if (rest.priority !== undefined) updates.priority = rest.priority
  if (rest.status !== undefined) {
    updates.status = rest.status
    updates.done = doneFromStatus(rest.status)
  }
  
  await ctx.db.update(tasks).set(updates).where(eq(tasks.id, id))
  const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id))
  if (!row) return null
  
  // Write back changed fields to Notion
  let notionSync: WriteBackResult | null = null
  if (row.source === 'notion' && row.notionPageId && oldRow) {
    const changedFields: Parameters<typeof pushTaskProperties>[0] = {
      notionPageId: row.notionPageId,
      notionAccount: row.notionAccount,
      notionDb: row.notionDb,
    }
    let hasChanges = false
    
    if (rest.title !== undefined && rest.title !== oldRow.title) {
      changedFields.title = rest.title
      hasChanges = true
    }
    if (rest.priority !== undefined && rest.priority !== oldRow.priority) {
      changedFields.priority = rest.priority
      hasChanges = true
    }
    if (rest.dueDate !== undefined && rest.dueDate !== oldRow.dueDate) {
      changedFields.dueDate = rest.dueDate
      hasChanges = true
    }
    if (rest.status !== undefined && rest.status !== oldRow.status) {
      changedFields.status = rest.status as CanonicalStatus
      hasChanges = true
    }
    
    if (hasChanges) {
      notionSync = await pushTaskProperties(changedFields)
      if (notionSync?.ok) {
        await ctx.db
          .update(tasks)
          .set({ notionStatusRaw: notionSync.label ?? row.notionStatusRaw })
          .where(eq(tasks.id, id))
        row.notionStatusRaw = notionSync.label ?? row.notionStatusRaw
      }
    }
  }
  
  return { ...row, notionSync }
}),
```

**`packages/api/src/routers/meetings.ts` `update` mutation:**

```typescript
update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
  const now = new Date().toISOString()
  
  // Read old row for comparison
  const [oldRow] = await ctx.db
    .select()
    .from(meetings)
    .where(eq(meetings.id, input.id))
  
  // Existing logic for series (unchanged)
  const seriesId = oldRow?.calendarEventId
    ? undefined
    : await ensureManualSeries(ctx, { ... })
  
  // Apply local update
  await ctx.db
    .update(meetings)
    .set({
      title: input.title,
      date: input.date,
      time: input.time ?? undefined,
      recurring: input.recurring ?? null,
      recurrenceDay: input.recurrenceDay ?? null,
      notes: input.notes ?? null,
      category: input.category ?? undefined,
      projectId: input.projectId ?? null,
      typeId: input.typeId ?? null,
      seriesId,
      updatedAt: now,
    })
    .where(eq(meetings.id, input.id))
  
  // Meeting people (unchanged)
  if (input.peopleIds !== undefined) { ... }
  
  const [row] = await ctx.db.select().from(meetings).where(eq(meetings.id, input.id))
  
  // Write back changed fields to Notion
  let notionSync: MeetingWriteBackResult | null = null
  if (row?.notionPageId && oldRow) {
    const changedFields: Parameters<typeof pushMeetingProperties>[0] = {
      notionPageId: row.notionPageId,
    }
    let hasChanges = false
    
    if (input.title !== oldRow.title) {
      changedFields.title = input.title
      hasChanges = true
    }
    if (input.date !== oldRow.date || (input.time ?? oldRow.time) !== oldRow.time) {
      // Skip sentinel dates
      if (input.date !== '9999-12-31' && input.date) {
        changedFields.date = input.date
        changedFields.time = input.time ?? '09:00'
        hasChanges = true
      }
    }
    
    if (hasChanges) {
      notionSync = await pushMeetingProperties(changedFields)
    }
  }
  
  return { ...row, notionSync }
}),
```

## Files

| File | Change |
|---|---|
| `packages/api/src/services/notion-task-writeback.ts` | Extend: `pushTaskProperties` (unified), refactor `pushTaskStatus` as wrapper |
| `packages/api/src/services/notion-meeting-writeback.ts` | New: `pushMeetingProperties`, token resolution, schema cache |
| `packages/api/src/routers/tasks.ts` | Wire `pushTaskProperties` in `update` with change detection |
| `packages/api/src/routers/meetings.ts` | Wire `pushMeetingProperties` in `update` with change detection |
| `packages/api/src/services/notion-graph-sync.ts` | Guard: do not overwrite real local date with `9999-12-31` from Notion |
| `apps/web/src/components/Modals/TaskModal.tsx` | Widen hint, surface `notionSync` on edit |
| `apps/web/src/components/Modals/MeetingModal.tsx` | Add hint when `notionPageId`, surface `notionSync` |
| `apps/mobile/app/task/[id].tsx` | Widen hint to match web |
| `packages/api/src/services/notion-task-writeback.test.ts` | Extend: title, priority, due date writeback cases |
| `packages/api/src/services/notion-meeting-writeback.test.ts` | New: meeting writeback + graph-sync guard cases |
