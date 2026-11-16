# Review — project-world-scoping

**Spec:** `docs/specs/project-world-scoping.md`
**Verdict:** APPROVED WITH NITS
**Date:** 2026-11-16

## What changed

### Resolver — `packages/api/src/services/world-scope.ts`

- A world is any `workspaces` row with no parent. Nothing is hardcoded; the tests run with a fifth world.
- **Meeting world** comes from the first known signal, ARO's own tagging first: manual → series → calendar (new `workspace_calendars`) → attendees (all in one world, owner excluded) → project → **Notion meeting DB, last, as a fallback only**.
- When ARO's signal and Notion disagree, ARO's world is kept and the meeting is listed on `/settings/workspaces` under "Notion חולק על העולם" (keep ARO / accept Notion; both pin the world as manual). A `notion_world_disagreement` insight counts them.
- Notion task sync does not apply a project from another world than the task's, and keeps the project ARO has.
- **Project world:** manual, else 80% of at least 3 tasks, else 80% of at least 3 meetings whose world did not come from the project. That last condition prevents a loop.
- Manual values are never overwritten. Project worlds set before this feature are kept as `manual`.
- Re-resolution runs:
  - in a one-shot backfill (`user_settings.world_scope_backfilled_at`);
  - on every sync that touched meetings (`reindexHarnessScopes`);
  - in the 6-hourly harness cron;
  - immediately when a calendar is mapped.

### Enforcement

- **Manual paths** are refused with a Hebrew message naming both worlds:
  - `meetings.create`, `meetings.update` and `meetings.setWorkspace`;
  - `tasks.create` and `tasks.update`;
  - choosing a project for a voice recording.
- **Automatic linkers** skip the cross-world link and log it:
  - voice auto-match and attach;
  - every Notion graph relation (meeting↔project, project→meetings, project→tasks, note→project);
  - the note body's project copy.
- The harness writes a `BELONGS_TO` edge only when there is no conflict.

### Conflicts

- The `worlds` router: `list`, `calendars.list` / `calendars.set`, `conflicts`, `resolveConflict` (unlink or move), `reresolve`.
- The `project_world_conflict` detector produces one insight per pair of worlds.

### Hugo

- The owner block lists each world's projects (12 shown, `+N`) plus a `ללא עולם` line, and the one-world rule. That reaches every agent.
- `get_projects` returns `worldName`, and `get_project_context` returns `world` with its source.
- Single-meeting prep (`focusTitle`) drops notes whose meeting is in another known world.

### UI

- `/settings/workspaces` ▸ "פרויקטים לפי עולם":
  - counts per world;
  - a calendar → world select;
  - the cross-world links, each with "נתק פרויקט" / "העבר ל-…";
  - a "חשב עולמות מחדש" button.
- Project pickers in `MeetingModal` and `TaskModal` show that world's projects, then "ללא עולם". A selection from another world stays visible, marked "עולם אחר".
- The project page shows a world badge plus its source.

## Checks

| check | result |
|---|---|
| `packages/api` Vitest | 147 files, 1606 tests pass (`world-scope.test.ts`: 12 new) |
| `apps/web` Vitest | 53 files, 348 tests pass |
| Playwright | `project-world-scoping.spec.ts`, `hugo-context-layers.spec.ts`, `hugo-entity-memory.spec.ts` and `project-meeting-notes-collapse.spec.ts` pass (6 tests) |
| `pnpm -r run lint` | no new findings |
| `pnpm --filter @ak-system/web build` | passes |

## Deviations from spec

- **No inherited world for new tasks.** A manually created task does **not** inherit its project's world. Setting `tasks.workspaceId` pushes the task into that world's Notion DB, which is a side effect the owner did not ask for. The cross-world check still applies.
- **Some mapping changes apply on the next sync.** Changing a series world, a person affiliation or a Notion DB link is picked up on the next sync or harness run (at most 15 minutes), not immediately. Calendar mapping is immediate.
- **Meetings are re-resolved in bulk.** After a sync that touched meetings, all non-manual meetings are re-resolved, not only the touched ones. This is cheap at current volume.
- **No new UI for meeting DBs.** A Notion meeting DB is linked to a world through the existing workspace modal (`linkNotionDatabase`). The resolver matches by DB name. Task sync is unaffected, because it maps by DB id.
- **Prep filters notes only.** The world filter in single-meeting prep applies to notes; tasks in prep come from Notion tools.
- **The one-world rule lives in the owner block**, which reaches every agent, not in a separate CoS line.

## Nits / follow-ups

1. Production has most meetings without a world until calendars and Notion meeting DBs are mapped once on `/settings/workspaces`.
2. `calendarLabel` shows a hash prefix for Google group calendars. A friendly name would need the calendar list from Google.
