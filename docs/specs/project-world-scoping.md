# Projects belong to one world

> **Slug:** `project-world-scoping`
> **Status:** Draft
> **Last Updated:** 2026-11-16
> **Builds on:** `harness-project-topic-nodes.md`, `owner-priorities-profile.md`

## Goal

Every project, meeting and task resolves to exactly one **world**, which is a `workspaces` row with `parentId = null`. The system never links a project to a meeting, task or note from a different world, and Hugo knows which projects live in which world.

The rule is **deterministic**: no LLM calls, and no hardcoded world names. Worlds are whatever rows exist in `workspaces` today (Dragontail, DAZ, Alpir Consulting, פרטי), and any world added later works the same way.

### Why

- A Dragontail project can be attached to a DAZ meeting today. Nothing checks world consistency when linking:
  - manual pickers (`MeetingModal`, `TaskModal`);
  - automatic linkers: `voice.ts` (×3), `notion-graph-sync.ts`, `notion-meeting-note-body.ts`.
- A world is rarely known for meetings or projects. In the local snapshot:
  - 0 of 822 meetings have a `workspaceId`;
  - 0 of 32 projects have one;
  - 0 of 17 meeting series have one;
  - by contrast, 179 of 182 tasks have one, because each Notion task DB is mapped to a workspace.
- The signals needed to infer a meeting's world already exist; they are just not used:
  - Notion meeting DBs ("DT - Meetings", "Con Meetings", "DAZ Internal Meetings") on `meeting_notes.notion_db`;
  - the meeting series;
  - the calendar the event came from;
  - attendees' `person_workspaces` affiliations.
- Hugo sees projects as one flat list, with no world attached.

## Definitions

- **World of a workspace:** the workspace itself when `parentId` is null, otherwise its parent.
- **Known world:** a non-null world id after resolution. Unknown means "no signal". It never means "every world".
- **Conflict:** both sides have a known world, and the two worlds differ. A side whose world is unknown never conflicts.

## User stories

- As Alpir, I never want a DAZ meeting linked to a Dragontail project, whether I pick the project or the system links it automatically.
- As Alpir, when I open a meeting's project picker, I want to see that world's projects first, plus projects that have no world yet, and never projects from another world.
- As Alpir, I want meetings and projects to get their world automatically from signals that already exist, without me tagging 800 meetings by hand.
- As Alpir, I want to tell the system once which calendar and which Notion DB belong to which world. That should be configuration, not code.
- As Alpir, I want a list of existing wrong links, so I can fix them, rather than having them deleted silently.
- As Alpir, I want Hugo to know which projects belong to which world, and never to mix them in a brief.

## Acceptance criteria

### Resolution (packages/api/src/services/world-scope.ts — new)

- [ ] `worldOf(workspaceId)` returns the root world id, or null. The workspace map is cached per process for 5 minutes and cleared on workspace mutations.
- [ ] **Project world** is resolved in this order:
  1. `projects.workspaceId` set manually (`workspace_source = 'manual'`).
  2. The tasks signal: at least 80% of the project's tasks that have a world share one world, with at least 3 such tasks.
  3. The meetings signal: the same 80% / 3 rule over the project's meetings that have a **non-project-derived** world.

  The result is stored in `projects.workspace_id` + `workspace_source` (`tasks` | `meetings`), and never overwrites `manual`.
- [ ] **Meeting world** is resolved in this order; the first known signal wins:
  1. `meetings.workspaceId` with `workspace_source = 'manual'`;
  2. the meeting's series (`meeting_series.workspace_id`);
  3. its Notion note's DB: `meeting_notes.notion_db` + `notion_account` matched against `workspace_notion_databases`, by database name, plus the account label when one is set;
  4. its calendar: `meetings.calendar_id` matched in the new `workspace_calendars` table;
  5. its attendees: every non-self attendee with any `person_workspaces` affiliation is affiliated to the same single world, with at least one such attendee;
  6. its project, when the project's world is known and its source is not `meetings`. That restriction prevents a loop.

  The result is stored in `meetings.workspace_id` + `workspace_source` (`series` | `notion` | `calendar` | `attendees` | `project`), and never overwrites `manual`.
- [ ] **Task world** is unchanged (it comes from the Notion DB mapping). A manually created task gets the world of its project or meeting when it has none of its own.
- [ ] **When resolution runs:**
  - a one-shot backfill, guarded by `user_settings.world_scope_backfilled_at`;
  - then for meetings touched by `calendar-sync` / `notion-sync`;
  - for projects in the 6-hourly harness cron;
  - immediately when a mapping (`workspace_calendars`, `workspace_notion_databases`, a series world, or a person affiliation) changes. That re-resolve covers non-manual rows only.

### Enforcement

- [ ] `assertSameWorld(db, { projectId, meetingId? , taskId?, workspaceId? })` throws `TRPCError BAD_REQUEST` with a Hebrew message naming both worlds, e.g. "הפרויקט Algo 4 שייך ל-Dragontail והפגישה ל-DAZ".
- [ ] Every **manual** project assignment calls it:
  - `meetings.create`;
  - `meetings.update`;
  - task create and update;
  - linking a meeting note to a project.
- [ ] Every **automatic** linker checks the same condition with `sameWorld()` and **skips** the link on a conflict, logging it with `console.info`. Never fail the sync. The linkers are:
  - `voice.ts` (the three project writes);
  - `notion-graph-sync.ts` (meeting patch + `meetingNoteProjects`);
  - `notion-meeting-note-body.ts`;
  - analysis/linking that sets `projectId`.
- [ ] Changing a **meeting's or task's world** manually while it has a project from another world is rejected, with the same message.
- [ ] Changing a **project's world** manually is allowed. It returns `{ conflicts: n }`, and the conflicts then surface through the detector below.

### Pickers

- [ ] `projects.list` gains an optional `worldId` input. With it, the result holds that world's projects plus projects whose world is unknown; projects of other worlds are excluded. Each row returns `worldId` and `worldName`.
- [ ] `MeetingModal` and `TaskModal` pass the resolved world of the meeting or task, when known, and group the options: that world first, then "ללא עולם". The current selection is always shown, even when it conflicts, and is marked "עולם אחר" so the user can fix it.

### Existing wrong links

- [ ] **New harness detector `project_world_conflict`.** One insight per world pair, `attention`, listing up to 5 conflicting meetings or tasks. Its sources are the project and meeting nodes, with dedupe key `project_world_conflict:<worldA>:<worldB>`.
- [ ] **New procedure `worlds.conflicts()`.** It returns every conflicting meeting and task link: the item, the project, and both worlds. `/settings/workspaces` gets a "קישורים בין עולמות" list where each row can **unlink the project** or **move the item to the project's world**. Nothing is unlinked automatically.

### Hugo and the agents

- [ ] The owner-profile "עולמות" lines list each world's projects, up to 12 names per world plus "+N", taking active projects first by last meeting. A final line lists "ללא עולם: …" when any project's world is unknown.
- [ ] `get_projects` returns `worldName` per project.
- [ ] `get_project_context` returns `world`.
- [ ] The harness project node attrs include `worldId`.
- [ ] A new CoS line says: a project belongs to exactly one world. Never attach, suggest or brief a project inside a meeting or task of another world. When the world of a meeting is unknown, say so instead of guessing.
- [ ] **Meeting prep for one meeting.** `insights.meetingNotes` with a single `meetingId` / prep for one meeting drops notes and tasks whose known world differs from the meeting's known world. This sits on top of the existing topic isolation. Day-wide prep is unchanged.
- [ ] **Harness:** a `BELONGS_TO` edge is written only when the meeting and the project do not conflict.

### Configuration UI (`/settings/workspaces`)

- [ ] For each world, a **"יומנים"** section lists the connected calendars (the same source as the agent-calendars picker) with a world selector. A calendar maps to at most one world; this is stored in `workspace_calendars`.
- [ ] The existing Notion DB mapping per workspace now also accepts **meeting** DBs. The same table holds them, and no kind column is needed: a name match is enough for meetings, because task sync matches by its own DB id.
- [ ] The "קישורים בין עולמות" list, as above.

## Data model

All changes are additive, in `schema.pg.ts` and `schema.ts`, plus the SQLite bootstrap.

### `workspace_calendars` (new)

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `workspace_id` | text notNull | FK → `workspaces.id`, cascade |
| `calendar_id` | text notNull | unique; same format as `meetings.calendar_id` (`google:<account>:<calId>`, `apple:<…>`) |
| `created_at` | text notNull | |

### Changed tables

- `projects.workspace_source`: text, nullable. Values: `manual` | `tasks` | `meetings`. Existing non-null `workspace_id` rows are backfilled as `manual`.
- `meetings.workspace_source`: already exists. New values: `series` | `notion` | `calendar` | `attendees` | `project`.
- `user_settings.world_scope_backfilled_at`: text, nullable.

## tRPC API

**New router** `packages/api/src/routers/worlds.ts`. It is new because world resolution spans projects, meetings and tasks and owns its own config.

| procedure | kind | input | returns |
|---|---|---|---|
| `list` | query | none | `{ id, name, kind, projectCount, meetingCount }[]` (worlds only) |
| `calendars.list` | query | none | `{ calendarId, label, workspaceId \| null }[]` |
| `calendars.set` | mutation | `{ calendarId, workspaceId: string \| null }` | `{ ok, reresolved: number }` |
| `conflicts` | query | none | `{ kind: 'meeting' \| 'task', id, title, projectId, projectName, itemWorld, projectWorld }[]` |
| `resolveConflict` | mutation | `{ kind, id, action: 'unlink' \| 'move' }` | `{ ok }` |
| `reresolve` | mutation | none | `{ meetings: n, projects: n }` (manual run) |

Changed procedures:

- `projects.list`: input adds `worldId?`; output adds `worldId` and `worldName`.
- `projects.update` with `workspaceId`: sets `workspace_source = 'manual'` and returns `conflicts`.
- `meetings.create`, `meetings.update`, task create/update, `meetings.setWorkspace`: call `assertSameWorld`.

## UI surface

UI Designer review is required.

- `apps/web/src/app/settings/workspaces/page.tsx`: the יומנים section, meeting-DB mapping, and קישורים בין עולמות.
- `apps/web/src/components/Modals/MeetingModal.tsx` and `TaskModal.tsx`: world-filtered, grouped project options, the "עולם אחר" mark, and the Hebrew conflict error from the server.
- The project page header shows its world badge (`WorldBadge`, which exists) with the source ("ידני" / "לפי משימות").

## Tests

- **Vitest — resolver:**
  - each meeting signal in precedence order, and `manual` never overwritten;
  - the attendees rule with mixed affiliations (gives unknown);
  - the project 80% / 3 rule;
  - no loop between the project and meeting signals;
  - a world that is not hardcoded (create a fifth world in the test).
- **Vitest — enforcement:**
  - manual create/update rejected on a conflict;
  - allowed when either side is unknown;
  - each automatic linker skips on a conflict.
- **Vitest — the rest:** the `project_world_conflict` detector; `worlds.conflicts` / `resolveConflict`; `projects.list({ worldId })` filtering; prep notes filtered by world for a single meeting.
- **Prompt contract test:** projects are listed under their world in the owner block.
- **Playwright:**
  - map a calendar to a world in settings;
  - a meeting from that calendar shows only that world's projects (plus unassigned) in its picker;
  - a conflict row can be unlinked.

## Out of scope

- Workspaces inside a world restricting projects further. The rule is per **world** only.
- Multi-world projects. A project has one world; when work truly spans worlds, it becomes two projects.
- Inferring a world with an LLM.
- Re-assigning tasks' worlds. Tasks keep their Notion-DB world.

## Open questions

- Is 80% / at least 3 the right bar for inferring a project's world from its tasks? A lower bar assigns more projects but risks wrong guesses. Manual always overrides.
