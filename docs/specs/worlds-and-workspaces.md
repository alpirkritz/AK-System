# Worlds and Workspaces — one organizing layer for everything

> **Slug:** `worlds-and-workspaces`
> **Status:** Approved — decisions locked 2026-10-20
> **Last Updated:** 2026-10-20
> **Builds on:** `people-domain-hierarchy` (deployed), `task-workspaces`, `notion-task-source-manager`

## Goal

Today the only things that "belong" somewhere are tasks (through the Notion database they sync from) and, since today, people. Projects, meetings, meeting series, commitments, recordings and notes have no home. And the `workspaces` table is really a list of task sources, so "DAZ - Engineering Tasks" and "Design Tasks" appear as peers of DAZ instead of parts of it.

This spec adds one organizing layer across the whole system:

- **World (עולם)** — the top level of Alpir's life: DAZ, Dragontail, Alpir Consulting, פרטי. New worlds can be created at any time.
- **Workspace (סביבת עבודה)** — an optional sub-area inside a world, e.g. DAZ → Management board, Engineering, Design. Each workspace keeps its own Notion task databases, so it is always clear where a task came from. Two workspaces in the same world can be merged with one button.
- **Everything answers "where does this belong?"** — tasks, people, projects, meetings, meeting series directly; commitments, recordings and notes by inheritance.
- **A global world filter, off by default.** The normal view is everything, because Alpir is the same person across all worlds. Picking "DAZ" narrows the lists until switched back to "הכל".

## Model

```
World (workspaces row, parent_id = NULL)
 └─ Workspace (workspaces row, parent_id = world id)   ← optional, one level only
      └─ Notion task databases (workspace_notion_databases, unchanged)
```

| Item | Belongs to | How it is set |
|---|---|---|
| Notion task database | one world or workspace | Settings (exists today) |
| Task | one world or workspace | From its database on sync; manual override in the task modal (exists) |
| Person | many worlds/workspaces | Drawer "שיוכים" (deployed today) |
| Project | one world or workspace | New picker on the project page and project modal |
| Meeting series | one world or workspace | New picker on the series; meetings inherit |
| Meeting | one world or workspace | Auto: series → calendar default → attendees; manual override always wins |
| Commitment / recording / note | inherited | From its meeting → project → person. No column, no manual input |
| Calendar | default world/workspace | Settings — e.g. the Dragontail Outlook calendar → Dragontail |

A filter on a world always includes its workspaces. A filter on a workspace includes only that workspace.

## User Stories

- As Alpir, I want DAZ to contain Management board, Engineering and Design as sub-areas, so I see they are one company but still know which database each task came from.
- As Alpir, I want to merge two workspaces in the same world with one button when I decide they are really one.
- As Alpir, I want to open a new world or workspace from settings whenever my life changes.
- As Alpir, I want to assign a project, meeting, task or person to a world/workspace by hand.
- As Alpir, I want meetings to land in the right world automatically (by series, calendar or attendees) so I rarely have to tag them.
- As Alpir, I want to pick "DAZ" once at the top and see only DAZ across tasks, meetings, projects, people and the dashboard.
- As Alpir, I want Hugo to know the world of every item so it can answer "what's open in DAZ this week?".

## Acceptance Criteria

### Hierarchy
- [ ] `workspaces.parent_id` exists. A row with `parent_id = NULL` is a world; a row with a parent is a workspace. Nesting deeper than one level is rejected (Hebrew error).
- [ ] Only worlds carry `kind` (employer / own_company / personal / other); a workspace shows its world's kind.
- [ ] **No automatic migration.** Existing rows stay as they are: "DAZ - Engineering Tasks", "Design Tasks" and the DAZ Tasks database are not moved, renamed, or reparented. The owner parents or merges them later from settings, one action at a time.
- [ ] Any world can hold workspaces, including פרטי — not only the companies.
- [ ] Deleting a world with workspaces is blocked until its workspaces are moved or deleted.

### Merge
- [ ] `workspaces.merge({ fromId, intoId })` — both must be in the same world (or `intoId` is the world itself). Moves Notion database links, tasks, projects, meetings, series, person links (kept row wins on conflict) and calendar defaults to `intoId`, then deletes `fromId`. Runs in one transaction.
- [ ] Tasks keep `notion_db`, so after a merge each task still shows its source database name.
- [ ] The UI asks for confirmation showing counts ("יועברו 82 משימות, 2 פרויקטים…").

### Assignment
- [ ] `projects.workspace_id`, `meetings.workspace_id`, `meeting_series.workspace_id` exist (nullable).
- [ ] Project page/modal, meeting page, and series view have a world/workspace picker (grouped by world).
- [ ] Person drawer "שיוכים" lists workspaces grouped under their world.
- [ ] Task modal's existing workspace select is grouped by world.

### Automatic meeting placement
- [ ] `meetings.workspace_source` ∈ `manual | series | calendar | attendees | null`. A `manual` value is never overwritten by automation.
- [ ] On calendar sync and in a one-time backfill, a meeting without a manual choice gets: the series' workspace → else the calendar's default (`calendar_workspace_defaults`) → else, when **all** linked confirmed attendees share exactly one world, that world → else stays empty.
- [ ] Setting a series' workspace re-places its non-manual meetings.

### Global world filter
- [ ] A switcher in the app header: "הכל" (the default, and what loads when nothing was picked) plus each world, each expandable to its workspaces. A picked choice persists across pages and reloads (localStorage). Clearing it returns to the overall view.
- [ ] When a world is selected, tasks, projects, meetings, people and the dashboard widgets that list those show the matching items, and underneath them a separate "לא משויך" group of items that have no world yet. "הכל" shows everything in one list, with no separate group.
- [ ] Each list shows a small "מסונן: DAZ ✕" chip; ✕ resets to "הכל".
- [ ] Every task, project, meeting and person row shows a world badge (world color; workspace name as a suffix when relevant, e.g. "DAZ · Engineering").
- [ ] Works on Z Fold 7 folded (390px): the switcher collapses to a single chip that opens a bottom sheet.

### Hugo / Harness
- [ ] Task, project, meeting and person nodes carry `world` and `workspace` in attrs; commitments/recordings/notes carry the inherited world.

## Data Model

Both `schema.pg.ts` (source of truth) and `schema.ts` (SQLite mirror), plus SQLite bootstrap blocks in `packages/database/src/index.ts` written in drizzle-kit's exact format (table-level `FOREIGN KEY … ON UPDATE no action`) — production applies schema only through that bootstrap (see `people-domain-hierarchy` → "Production rollout").

| Change | Type |
|---|---|
| `workspaces.parent_id` | text, nullable, FK → workspaces.id ON DELETE restrict; index `idx_workspaces_parent_id` |
| `projects.workspace_id` | text, nullable, FK → workspaces.id ON DELETE set null; index |
| `meetings.workspace_id` | text, nullable, FK set null; index |
| `meetings.workspace_source` | text, nullable |
| `meeting_series.workspace_id` | text, nullable, FK set null; index |
| new `calendar_workspace_defaults` | `calendar_id` text PK, `workspace_id` text not null FK cascade, `created_at`, `updated_at` |

Unchanged: `tasks.workspace_id`, `workspace_notion_databases`, `person_workspaces`.

New service `packages/api/src/services/workspace-scope.ts`:
- `workspaceTree(db)` → worlds with children.
- `expandWorkspaceFilter(db, id)` → `[id, ...childIds]` (used by every list filter).
- `resolveWorld(db, workspaceId)` → `{ world, workspace }` for badges and Harness.
- `placeMeeting(db, meetingId)` / `backfillMeetingPlacement(db)`.
- `mergeWorkspaces(db, fromId, intoId)`.

## tRPC API

All `protectedProcedure`.

**`workspaces` router**
- `tree()` → `Array<World & { children: Workspace[], counts: { tasks, projects, meetings, people } }>`
- `create` — input gains `parentId?: string | null`.
- `update` — input gains `parentId?: string | null` (move between worlds; depth rule enforced).
- `mergePreview({ fromId, intoId })` → counts per entity.
- `merge({ fromId, intoId })` → `{ ok, moved: counts }`.
- `setCalendarDefault({ calendarId, workspaceId | null })`, `calendarDefaults()`.

**List filters** — add `workspaceId?: string` (expanded to children) to:
`tasks.list` (exists — switch to expansion), `projects.list`, `meetings.list` (and the paginated/temporal variants used by `/meetings`), `people.listPaginated` (exists — switch to expansion), dashboard queries that list tasks/meetings.

**Setters**
- `projects.update` / `projects.create` — `workspaceId?: string | null`.
- `meetings.setWorkspace({ meetingId, workspaceId | null })` — sets `workspace_source = 'manual'` (or clears to automatic when null).
- `meetings.setSeriesWorkspace({ seriesId, workspaceId | null })` — re-places the series' non-manual meetings.

## UI Surface

- **Header switcher** — `apps/web/src/components/WorldSwitcher.tsx` in `DashboardLayout.tsx`; state in a small React context `apps/web/src/lib/world-filter.tsx` (localStorage key `ak.worldFilter`). Pages read it and pass `workspaceId` to their queries: `/`, `/tasks`, `/projects`, `/meetings`, `/people`.
- **Settings → עולמות** — `/settings/workspaces` becomes a tree: each world card lists its workspaces, and under each its Notion databases, calendars and counts. Actions: "+ עולם חדש", "+ סביבת עבודה" inside a world, edit, move, merge (confirm with counts), delete. Calendar defaults section lists connected calendars with a world/workspace select.
- **Pickers** — shared `WorkspacePicker.tsx` (select grouped by world, `<optgroup>`), used in TaskModal, project page/modal, meeting page, series view, and the person drawer form.
- **Badges** — shared `WorldBadge.tsx` (color dot + "DAZ · Engineering"), used in task rows, project cards, meeting rows, people rows/cards (replacing the current per-workspace badge styling).
- RTL, dark theme, `.btn`/`.input`/`.card`/`.filter-chip`; 390px and 768px layouts as in `people-domain-hierarchy`.

## Rollout

1. Phase 1 — hierarchy, merge, settings tree, project/meeting/series columns and pickers, global switcher on tasks/projects/meetings/people, badges.
2. Phase 2 — automatic meeting placement + calendar defaults + backfill, dashboard filtering, Harness attrs, inherited world for commitments/recordings/notes.
3. Production: DB backup + rollback image before deploy. Nothing is reparented or merged by the deploy itself.

## Out of Scope

- Companies (clients/vendors) belonging to worlds — a company can serve several worlds; follow-up.
- More than two levels (world → workspace → sub-workspace).
- Projects or meetings in several worlds at once (decided: one).
- Per-world permissions or separate logins.
- Mobile app (`apps/mobile`) switcher — follow-up; it keeps working unfiltered.
- Changing how Notion sync decides a task's workspace (still by database link).

## Decisions (2026-10-20)

1. **Leave the current data as it is.** No Management-board split, no automatic parenting of Engineering or Design under DAZ. Organizing happens later, by hand, from settings.
2. **The default view is everything.** The world switcher is optional. Not picking one shows the overall picture across all worlds.
3. **Unassigned items stay visible** in their own "לא משויך" group while a world is selected.
4. **Workspaces exist under every world**, including פרטי.
