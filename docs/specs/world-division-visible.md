# World division, visible on the daily screens

> **Slug:** `world-division-visible`
> **Status:** Implemented
> **Last Updated:** 2026-10-21
> **Builds on:** `worlds-and-workspaces` (model and settings tree already in the tree; the header switcher, badges, and list filters from that spec are not on screen)

## Goal

The world/workspace model is right: Alpir is one person, the default view is everything, and an item belongs to a world. That division is not readable. Tasks hide it behind «סינון» and call it «מקור». Meetings have a column and no control. People show a badge only after a manual affiliation, on a separate chip row that resets when you leave the page. This spec puts one persistent switcher in the header and the same badge on tasks, meetings, projects, and people, and retires the duplicate page-local filters.

## User stories

- As Alpir, I want one control at the top that says «הכל» until I pick a world, so I can tell whether the screen is filtered.
- As Alpir, I want that choice to stay when I move between dashboard, tasks, meetings, projects, and people, and after a reload, so I am not re-deciding on every page.
- As Alpir, I want each task, meeting, project, and person row to show its world, so the division is visible even while «הכל» is selected.
- As Alpir, I want a filtered list to keep unassigned items in a separate «לא משויך» group, so filtering does not look like data disappeared.
- As Alpir, I want to set a meeting's or a project's world from its page, so those rows can show a world without waiting for automatic placement.
- As Alpir, I want the word «עולם» everywhere this concept appears, so «מקור» stops meaning three different things.

## Acceptance criteria

### Switcher

- Given the app shell on a phone or desktop, when at least one world exists, then the top bar (the row that holds the notification bell in `DashboardLayout`) shows a switcher whose resting label is «הכל».
- Given no workspace rows, the switcher is absent.
- Given I pick a world or one of its workspaces, then `localStorage["ak.worldFilter"]` stores that id, the label becomes that name, and `/`, `/tasks`, `/meetings`, `/projects`, and `/people` all use it after navigation and after reload.
- Given a stored id that no longer exists, the switcher falls back to «הכל» and clears the key.
- Given the viewport is 390px wide, the switcher is a single chip of at least 44px that opens a bottom sheet. At 768px and up it opens a popover. Both list «הכל», then each world, with that world's workspaces indented under it.
- Choosing «הכל» removes the key and restores the unfiltered lists.

### Lists

- Given «הכל», tasks, meetings, projects, people, and the dashboard task and meeting widgets are one list. There is no «לא משויך» heading.
- Given a world is selected, each of those lists shows a `filter-chip` «מסונן: {name} ✕». ✕ returns to «הכל». A world filter includes that world and its child workspaces. A workspace filter includes only that workspace.
- Given a filter is on, rows that match are listed first. Rows with no world (a task, meeting, or project with `workspace_id` null; a person with zero affiliations) are listed under a heading «לא משויך». They are not omitted.
- The tasks page no longer has its own «מקור» chips inside «סינון». The people page no longer has its own «כל העולמות» chip row. Project and meeting selects inside the tasks «סינון» panel stay.

### Badges and words

- Every task row, meeting card, project card, and person row/card shows a badge: a color dot plus the world name. When the row is a child workspace, the text is `{world} · {workspace}` using the world's color.
- A row with no world shows the badge «לא משויך» on tasks, meetings, and projects. A person with no affiliation shows no badge (the drawer already explains that).
- User-facing copy for this concept says «עולם», not «מקור»: task modal, quick-add, batch task modal, the settings link, and `/settings/workspaces` title. The Notion people-database section on that settings page keeps its own wording.
- Task modal, quick-add, batch task modal, meeting page, and project modal use one grouped picker: an `<optgroup>` per world, child workspaces inside it, plus «ללא עולם».

### Assignment

- Given a meeting page, when I pick a world or workspace and save, `meetings.workspace_id` is that id and `meetings.workspace_source` is `manual`. Choosing «ללא עולם» sets both to null. The meetings list badge updates.
- Given a project modal, the same picker writes `projects.workspace_id`. Null clears it.
- Existing rows are not renamed, reparented, or auto-tagged by this change. A world that is still named «DAZ - Engineering Tasks» shows that name until it is edited in settings.

## Data model

No new tables or columns. Both schemas already have what this slice reads and writes:

- `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`: `workspaces.parent_id`, `tasks.workspace_id`, `projects.workspace_id`, `meetings.workspace_id`, `meetings.workspace_source`, `person_workspaces`.
- SQLite bootstrap in `packages/database/src/index.ts` already adds `meetings.workspace_source`. Do not add another migration.

`expandWorkspaceFilter` in `packages/api/src/services/workspace-scope.ts` is the filter implementation. A world id expands to `[id, ...childIds]`. A workspace id expands to `[id]`.

## tRPC API

All procedures stay on `protectedProcedure`. No new router.

**`packages/api/src/routers/tasks.ts`** — `tasks.list` (existing query)

- Input stays `{ workspaceId?: string }`.
- When `workspaceId` is omitted, return every task (current behavior).
- When it is set, return tasks whose `workspace_id` is in `expandWorkspaceFilter`, plus tasks whose `workspace_id` is null. Do not exact-match only the one id.

**`packages/api/src/routers/meetings.ts`** — `meetings.list` (existing query)

- Add optional `workspaceId: z.string().optional()` to the existing input object.
- When set, same rule as tasks: expanded ids, plus rows with `workspace_id` null. Rows already include `workspaceId` and `workspaceSource` because the query selects the table.

**`meetings.setWorkspace`** (new mutation)

- Input: `{ meetingId: string, workspaceId: string | null }`.
- `workspaceId` null clears `workspace_id` and `workspace_source`.
- A non-null id must exist in `workspaces`. Set `workspace_id` and `workspace_source = "manual"`.
- Return the updated meeting row. Hebrew `BAD_REQUEST` if the meeting or the world is missing.

**`packages/api/src/routers/projects.ts`**

- `projects.list`: add optional input `{ workspaceId?: string }`. Same match-or-null rule. Omitting input keeps today's unfiltered array (the input object itself is optional).
- `projects.getById`: include `workspaceId` in the selected shape.
- `projects.create` and `projects.update`: add `workspaceId: z.string().nullable().optional()`. On update, apply it only when the field is present. Reject an unknown id with Hebrew `BAD_REQUEST`.

**`packages/api/src/routers/people.ts`** — `people.listPaginated` (existing)

- Keep input `workspaceId?: string`.
- `personIdsInWorkspace` in `packages/api/src/services/person-workspaces.ts` takes the expanded id list, not one id.
- When `workspaceId` is set, the page of people is the union of those affiliations and people who have no `person_workspaces` row. When it is omitted, behavior is unchanged (every person once).

**`workspaces.tree`** (existing query) is what the switcher and the picker call. Do not add a procedure.

Client grouping: the procedures return a flat list that includes nulls. The page splits nulls under «לא משויך» only while a filter is active.

## UI surface

- `apps/web/src/lib/world-filter.tsx` — React context. Value is `string | null`. Read and write `localStorage` key `ak.worldFilter`. Provider wraps children inside `DashboardLayout` so `/login` and print routes stay bare.
- `apps/web/src/components/WorldSwitcher.tsx` — mounted in the top bar of `apps/web/src/components/DashboardLayout.tsx`, on the start side; `NotificationBell` stays at the end (`justify-between`). Uses `workspaces.tree`.
- `apps/web/src/components/WorldBadge.tsx` — dot + label. Replaces `WorkspacePill` on task rows, the task pill inside a meeting, and the task pill on a project page.
- `apps/web/src/components/WorkspacePicker.tsx` — `<select className="select">` with `<optgroup>` per world. Used by `TaskModal`, `QuickAddTaskModal`, `BatchTaskModal`, the meeting page, and `ProjectModal`.
- `apps/web/src/app/tasks/page.tsx` — drop the local `workspaceId` state and the «מקור» chip group. Read the context. Pass `workspaceId` into `tasks.list`. Render the filter chip and the «לא משויך» group.
- `apps/web/src/app/meetings/page.tsx` and `apps/web/src/app/meetings/components/MeetingCard.tsx` — pass the filter, show `WorldBadge` from `workspaceId`. `MeetingCardData` gains `workspaceId`.
- `apps/web/src/app/meetings/[id]/page.tsx` — picker bound to `meetings.setWorkspace`.
- `apps/web/src/app/people/page.tsx` via `PeopleFilterBar` and `usePeopleState` — remove `WorkspaceChips`. Feed context `workspaceId` into `people.listPaginated`. Group empty-affiliation people under «לא משויך» only while filtered. `WorkspaceBadges` stay on `PersonRow` and `PersonCard`.
- `apps/web/src/app/projects/page.tsx` and `apps/web/src/components/Modals/ProjectModal.tsx` — filter, badge, picker.
- `apps/web/src/app/page.tsx` — dashboard task and meeting widgets take the same filter and chip. Other dashboard blocks stay unfiltered.
- `apps/web/src/app/settings/page.tsx` — the link title becomes «עולמות». The description says these are the worlds the header filters by, and that a world can contain a סביבת עבודה.
- `apps/web/src/app/settings/workspaces/page.tsx` — h1 «עולמות». The intro no longer calls them מקורות. The tree already rendered there stays.

RTL, dark theme, existing `.btn`, `.input`, `.select`, `.card`, `.filter-chip`. No new dependency.

## Out of scope

- Automatic meeting placement, calendar defaults, and backfill (`worlds-and-workspaces` phase 2).
- Merge confirmation UI. `workspaces.merge` already exists and is not surfaced here.
- Harness / Hugo world attributes.
- Inherited world on commitments, recordings, and notes.
- Renaming or reparenting existing rows such as «DAZ - Engineering Tasks».
- Mobile app (`apps/mobile`).
- Filtering chat, calendar, finance, commitments, voice, or notifications.
- Changing the sidebar tagline «סביבת עבודה אישית».

## Open questions

None. The default remains «הכל», unassigned rows stay visible while a filter is on, and this slice does not move existing data.
