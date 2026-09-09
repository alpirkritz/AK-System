# Notion task ↔ meeting relation (two-way sync)

> **Slug:** `notion-task-meeting-relation`
> **Status:** Draft
> **Last Updated:** 2026-09-09
> **Stack:** `next-trpc-monorepo`
> **Builds on:** [`notion-task-people-relation-push`](notion-task-people-relation-push.md), [`notion-date-writeback`](notion-date-writeback.md)

## Goal

When a task is linked to a meeting locally (`tasks.meetingId`), and both have Notion page IDs, sync that relationship to Notion so the task's Meeting relation and the meeting's Tasks relation reflect the same link. Conversely, when Notion already has these relations, pull them into the local `tasks.meetingId`.

## Why

The app creates tasks from meetings (action items) and sets `meetingId` locally. Notion task databases (DT - Action items, Con Action items) have a `Meeting` relation property, and Meetings DB pages have a `Tasks` relation. These are currently disconnected: task-sync always inserts `meetingId: null`, and graph-sync reads the relation names but never applies meeting↔task edges.

Users see tasks linked to meetings in the app, but when they open the task page in Notion, the Meeting field is empty. Conversely, tasks manually linked to meetings in Notion don't show up as meeting-related in the app.

## Approach

Local-first, never-throw contract (same as `pushTaskProperties`, `pushTaskPeople`, `pushMeetingProperties`). Three sync paths:

1. **Pull task → meeting** (Notion task page Meeting relation → local `tasks.meetingId`)
2. **Pull meeting → tasks** (Notion meeting page Tasks relation → local `tasks.meetingId`)
3. **Push task ↔ meeting** (local `meetingId` change → both Notion relations, via merge)

### Discovery

Relations are detected by:
- **Target database type**: relation targets a configured `meetings` / `tasks` database
- **Property name pattern**: `/meeting|פגישה|ישיבה/i` for tasks; `/task|todo|action|משימ/i` for meetings

**Exclusions** (same as people-push): self-referencing relations (Sub-task, Parent task), People, Projects, Companies.

### Non-wipe rule

If Notion's relation is **empty** and the local `meetingId` is **set**, do not clear the local value — the user may have linked a calendar-only meeting (no `notionPageId`) which Notion can never represent. Only clear when Notion actively points *elsewhere*.

### Merge rule (meeting → tasks write)

When writing a task page ID to the meeting's Tasks relation:
- **Read** the current relation IDs from Notion
- **Keep** IDs that are **not** recognized local task pages (Notion-only links we never synced)
- **Add/remove** only this task's page ID
- **Skip** PATCH if unchanged

This preserves manual Notion-only task links while syncing app-managed ones.

## Data Model

No schema changes. Reads/writes:
- `tasks.meetingId` (exists)
- `tasks.notionPageId` (exists)
- `meetings.notionPageId` (exists, populated by graph-sync)

## tRPC API

No new procedures. Extensions to existing mutations:

### `tasks.create` / `tasks.update`

When `source === 'notion'` and `meetingId` changes:
1. Load `meetings.notionPageId` for the new meeting
2. Call `pushTaskMeeting({ notionPageId, notionAccount, notionDb, meetingNotionPageId })`
3. If meeting has `notionPageId`, call `pushMeetingTaskLinks({ meetingNotionPageId, taskNotionPageId, action: 'add' })` (or 'remove' on clear)

Return existing `{ ...row, notionSync }` shape; meeting-link failures go to `notionSync`.

### `notionGraph.sync` (task pull)

In the tasks loop (`packages/api/src/services/notion-tasks-sync.ts`):
- Call `getMeetingRelationPageIds(props)` (new helper, mirrors `getProjectRelationPageIds`)
- Resolve page IDs through `meetings.notionPageId` to get local `meetingId`
- On create: set `tasks.meetingId` if found
- On update: set `tasks.meetingId` if found **and not already set**; never clear

### `notionGraph.sync` (meeting pull)

In the meetings loop (`packages/api/src/services/notion-graph-sync.ts`):
- Read `getTypedRelationIds(page.properties, 'tasks')`
- For each task page ID, if `tasks.notionPageId` matches, set `tasks.meetingId` (same non-wipe rule)

## Service Layer

### `packages/api/src/services/notion-task-writeback.ts`

**Schema extension:**
```typescript
interface DatabaseSchema {
  // ... existing fields ...
  meetingRelation: MeetingRelationInfo | null
}

interface MeetingRelationInfo {
  propertyName: string
  targetDatabaseId: string
}
```

**Discovery:**
```typescript
function findMeetingRelation(
  properties: Record<string, unknown>,
  taskDatabaseId: string,
  configuredMeetingsDatabaseIds: string[],
): MeetingRelationInfo | null
```
Logic: configured meetings DB = proof; else name match `/meeting|פגישה|ישיבה/i`; skip self-refs.

**Write:**
```typescript
export async function pushTaskMeeting(input: {
  notionPageId: string
  notionAccount: string | null | undefined
  notionDb: string | null | undefined
  meetingNotionPageId: string | null  // null = clear
}): Promise<WriteBackResult>
```
- `null` → PATCH `{ Meeting: { relation: [] } }`
- Page ID → PATCH `{ Meeting: { relation: [{ id }] } }`
- No property → `{ ok: false, reason: 'no-meeting-relation' }`

**Hook in `createNotionTask`:**
If `input.meetingNotionPageId` is provided, write it to the discovered `meetingRelation`.

### `packages/api/src/services/notion-meeting-writeback.ts`

**Schema extension:**
```typescript
interface MeetingDatabaseSchema {
  // ... existing fields ...
  tasksRelation: TasksRelationInfo | null
}

interface TasksRelationInfo {
  propertyName: string
  targetDatabaseId: string
}
```

**Discovery:**
```typescript
function findTasksRelation(
  properties: Record<string, unknown>,
  meetingDatabaseId: string,
  configuredTasksDatabaseIds: string[],
): TasksRelationInfo | null
```

**Merge write:**
```typescript
export async function pushMeetingTaskLinks(input: {
  meetingNotionPageId: string
  taskNotionPageId: string
  action: 'add' | 'remove'
}): Promise<MeetingWriteBackResult>
```
1. Resolve token via `resolvePageToken`
2. GET current page's Tasks relation IDs
3. Load all local task `notionPageId`s
4. Keep IDs **not** in local set (Notion-only)
5. Add/remove the target task page ID
6. Skip PATCH if unchanged
7. PATCH `{ Tasks: { relation: merged } }`

### `packages/api/src/services/notion-tasks-sync.ts`

**New helper:**
```typescript
function getMeetingRelationPageIds(props: Record<string, NotionProp>): string[] {
  const ids: string[] = []
  for (const [name, v] of Object.entries(props)) {
    if (v?.type !== 'relation' || !Array.isArray(v.relation)) continue
    if (!/meeting|פגישה|ישיבה/i.test(name)) continue
    for (const r of v.relation as Array<{ id?: string }>) {
      if (r?.id) ids.push(r.id)
    }
  }
  return ids
}
```

**In sync loop:**
```typescript
const meetingNotionIds = getMeetingRelationPageIds(props)
const meetingId = meetingNotionIds
  .map((pageId) => meetingByNotionPageId.get(pageId))
  .find(Boolean) ?? null

// On create:
meetingId,  // instead of hardcoded null

// On update (existing task):
if (meetingId && !existingTask.meetingId) {
  updates.meetingId = meetingId
}
```

### `packages/api/src/services/notion-graph-sync.ts`

**In meetings loop (after upserting meeting):**
```typescript
const taskRelIds = getTypedRelationIds(page.properties, 'tasks')
for (const taskPageId of taskRelIds) {
  const [taskRow] = await db
    .select({ id: tasks.id, meetingId: tasks.meetingId })
    .from(tasks)
    .where(eq(tasks.notionPageId, taskPageId))
  if (taskRow && !taskRow.meetingId) {
    await db.update(tasks).set({ meetingId: id, updatedAt: now }).where(eq(tasks.id, taskRow.id))
  }
}
```

## UI Surface

### `apps/web/src/components/Modals/TaskModal.tsx`

**Hint** (after the people-sync hint):
```tsx
{(editingTask as { source?: string | null; notionPageId?: string | null } | null)
  ?.source === 'notion' &&
(editingTask as { notionPageId?: string | null } | null)?.notionPageId &&
(form.meetingId || editingTask?.meetingId) ? (
  <p className="mt-2 text-xs text-[#38bdf8]">
    מסונכרן עם Notion — קישור לפגישה יעודכן גם שם
  </p>
) : null}
```

**Error handling:**
Existing `notionSync` result in `onSuccess` already logs warnings; no new UI needed.

## Out of Scope

- Creating a Notion meeting page for calendar-only meetings (no `notionPageId`).
- Project relation writeback (separate spec: [`notion-task-people-relation-push`](notion-task-people-relation-push.md) §84 marked this deferred).
- Rewriting the entire meeting Tasks relation from scratch (would delete Notion-only links).
- Pulling/pushing when only one side has a Notion page (app handles this gracefully: local link saves, Notion skipped).

## Acceptance Criteria

### Pull (Notion → local)

- [ ] Task sync: Notion task page with Meeting relation → `tasks.meetingId` on create and update
- [ ] Task sync: Empty Notion Meeting relation does **not** clear existing local `meetingId`
- [ ] Graph sync: Notion meeting page with Tasks relation → `tasks.meetingId` for those tasks
- [ ] Graph sync: Empty Tasks relation does not clear existing `meetingId`

### Push (local → Notion)

- [ ] Task create with `meetingId` → Meeting relation written on task page (if both have `notionPageId`)
- [ ] Task update changing `meetingId` → Meeting relation updated on task page
- [ ] Task update changing `meetingId` → meeting's Tasks relation merged (add new, remove old)
- [ ] Task update clearing `meetingId` → Meeting relation cleared on task page; task removed from meeting's Tasks
- [ ] Calendar meeting (no `notionPageId`) → local link saves, Notion not called
- [ ] Meeting page with no Tasks relation → `no-tasks-relation` (silent, like `no-people-relation`)
- [ ] Task DB with no Meeting relation → `no-meeting-relation` (silent)

### Safety

- [ ] People / Projects / Sub-task / Parent task relations never written as Meeting/Tasks
- [ ] Self-referencing relations excluded
- [ ] Merge preserves Notion-only task links on meeting page
- [ ] No PATCH when Notion already matches local state

### Tests

- [ ] Vitest: `getMeetingRelationPageIds` selects Meeting, ignores People/Projects/Sub-task
- [ ] Vitest: `findMeetingRelation` prefers configured DB, falls back to name match
- [ ] Vitest: pull task → meeting; empty does not wipe
- [ ] Vitest: push meeting change → task page PATCH + meeting page merge
- [ ] Vitest: meeting merge keeps unknown IDs, adds/removes only known task
- [ ] Playwright (optional): create task from meeting, verify hint shown

## Open Questions

None — implementation follows established patterns from people-push, date-writeback, and meeting-writeback.
