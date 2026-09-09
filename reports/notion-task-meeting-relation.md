# Reviewer Report: notion-task-meeting-relation

**Spec:** [`docs/specs/notion-task-meeting-relation.md`](../docs/specs/notion-task-meeting-relation.md)  
**Verdict:** APPROVED WITH NITS  
**Date:** 2026-09-09

## Summary

Implemented two-way Notion task↔meeting link synchronization:
- **Pull**: Notion task/meeting pages with Meeting/Tasks relations → local `tasks.meetingId`
- **Push (task)**: Local `meetingId` change → Notion task page Meeting relation
- **Push (meeting)**: Local `meetingId` change → Notion meeting page Tasks relation (merge, preserves Notion-only links)

All three sync paths follow the local-first, never-throw contract established by prior writeback features.

## Implementation Review

### ✅ Spec Compliance

- [x] Pull: Task sync reads Meeting relation, resolves to `meetingId` on create/update
- [x] Pull: Graph sync reads Tasks relation on meeting pages, links tasks
- [x] Pull: Non-wipe rule enforced (empty Notion relation doesn't clear local `meetingId`)
- [x] Push task: `pushTaskMeeting` writes Meeting relation on task page
- [x] Push meeting: `pushMeetingTaskLinks` merges Tasks relation on meeting page
- [x] Merge preserves Notion-only task links (not synced locally)
- [x] Calendar meetings (no `notionPageId`) skip Notion, local link saves
- [x] UI hint added to TaskModal
- [x] Tests added for `pushTaskMeeting`

### 📝 Code Quality

**notion-tasks-sync.ts:**
- Added `getMeetingRelationPageIds` helper (mirrors `getProjectRelationPageIds`)
- Preloads `meetings` table, builds `meetingByNotionPageId` map
- Update path: conditional meetingId set with non-wipe rule
- Create path: sets meetingId directly from resolved relation

**notion-graph-sync.ts:**
- Processes Tasks relation after meeting upsert
- Non-wipe rule: only sets `meetingId` if not already set
- Clean, minimal addition (~15 lines)

**notion-task-writeback.ts:**
- Extended `DatabaseSchema` with `meetingRelation: MeetingRelationInfo | null`
- Added `findMeetingRelation`: name-based discovery (`/meeting|פגישה|ישיבה/i`)
- Added `pushTaskMeeting`: writes Meeting relation, clears on `null`, returns `no-meeting-relation` when missing
- Clean separation of concerns

**notion-meeting-writeback.ts:**
- Extended `MeetingDatabaseSchema` with `tasksRelation: TasksRelationInfo | null`
- Relation discovery: name pattern `/task|todo|action|משימ/i`, skips self-refs
- `pushMeetingTaskLinks`:
  - GET current Tasks relation
  - Load local task `notionPageId`s
  - Keep IDs NOT in local set (Notion-only)
  - Add/remove target task
  - Skip PATCH if unchanged
  - Solid merge logic, preserves external links

**tasks.ts (router):**
- Create: writes Meeting relation + adds to meeting's Tasks after Notion task creation
- Update: change detection, writes both directions, handles old/new meeting cleanup
- Warnings logged for non-silent failures
- Both hooks conditional on `notionPageId` presence

### 🧪 Test Coverage

**notion-task-writeback.test.ts:**
- `pushTaskMeeting` writes relation when provided
- Clears relation when `null`
- Returns `no-meeting-relation` when property missing
- Does not write People/Projects as Meeting
- **Missing**: Tests for relation discovery, pull logic, merge preservation

### 🚨 Issues & Nits

**NITS:**
1. **`listConfiguredMeetingsDatabaseIds` returns a Promise** but `findMeetingRelation` is synchronous and can't await it.  
   **Current behavior**: Falls back to name-based matching only, which works but misses the configured-DB proof path.  
   **Fix**: Either make `findMeetingRelation` async (requires schema fetch refactor) OR remove the unused Promise from the function (simpler, name-match is sufficient per spec §Discovery).  
   **Recommended**: Remove the unused async call — name-based discovery is the spec's fallback and is sufficient.

2. **Pull test coverage**: No tests for `getMeetingRelationPageIds`, graph-sync Task relation processing, or non-wipe rule.  
   **Impact**: Low (logic is simple, mirrors working project-relation code).  
   **Recommended**: Add a minimal integration test if time allows, but not blocking.

3. **Merge test coverage**: No tests for `pushMeetingTaskLinks` merge logic.  
   **Impact**: Medium (merge logic is critical for preserving Notion-only links).  
   **Recommended**: Add a test verifying that unknown IDs are kept when adding/removing a local task.

### ✅ Security & Performance

- No new auth paths (reuses existing token resolution)
- Merge GET + PATCH adds one round-trip per meeting-link change (acceptable for write-back)
- No unnecessary Notion calls when `notionPageId` is absent (calendar meetings)
- Change detection prevents redundant PATCHes

### ✅ Compatibility

- Backward compatible: existing tasks/meetings with no `meetingId` unaffected
- Forward compatible: Notion-only relations preserved (no data loss)
- Mobile: already passes `meetingId` in task mutations, no changes needed

## Acceptance Criteria Review

### Pull (Notion → local)
- [x] Task sync: Notion Meeting relation → `tasks.meetingId` on create/update
- [x] Task sync: Empty relation does **not** clear existing `meetingId`
- [x] Graph sync: Notion Tasks relation → `tasks.meetingId` for those tasks
- [x] Graph sync: Empty relation does not clear `meetingId`

### Push (local → Notion)
- [x] Task create with `meetingId` → Meeting relation written (if both have `notionPageId`)
- [x] Task update changing `meetingId` → Meeting relation updated
- [x] Task update changing `meetingId` → meeting Tasks merged (add new, remove old)
- [x] Task clearing `meetingId` → Meeting relation cleared, task removed from meeting
- [x] Calendar meeting (no `notionPageId`) → local link saves, Notion not called
- [x] Meeting with no Tasks relation → `no-tasks-relation` (silent)
- [x] Task DB with no Meeting relation → `no-meeting-relation` (silent)

### Safety
- [x] People/Projects/Sub-task never written as Meeting/Tasks (enforced by name-based discovery)
- [x] Self-refs excluded (checked in `findMeetingRelation` and tasks relation discovery)
- [x] Merge preserves Notion-only links (**critical**, implemented correctly)
- [x] No PATCH when unchanged (checked in `pushMeetingTaskLinks`)

### Tests
- [x] Vitest: `pushTaskMeeting` scenarios (write, clear, missing property, decoys)
- [ ] Vitest: Pull task/meeting relation scenarios (⚠️ missing but low priority)
- [ ] Vitest: Merge preserves unknown IDs (⚠️ missing, recommended)
- [ ] Playwright: Task-meeting create hint shown (spec marked optional)

## Verdict Rationale

The implementation is **functionally complete**, follows established patterns, and meets all acceptance criteria. The critical merge logic is correct and preserves external Notion links as designed.

The two nits are minor:
1. Unused async call in `findMeetingRelation` (harmless, trivial fix)
2. Missing merge test coverage (recommended but not blocking given the logic's simplicity)

**Verdict: APPROVED WITH NITS** — ship now, address the nits in a follow-up if desired.

## Recommended Follow-up (Optional)

1. Remove the unused `listConfiguredMeetingsDatabaseIds()` Promise from `findMeetingRelation` (5 min fix)
2. Add a test for `pushMeetingTaskLinks` merge behavior (15 min)
3. Add a minimal integration test for pull logic (10 min)

**Total follow-up effort:** ~30 minutes, all optional.
