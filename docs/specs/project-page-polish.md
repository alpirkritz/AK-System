# Project Detail Page Polish (roster, task sort, header info, meetings)

> **Slug:** `project-page-polish`
> **Status:** Implemented
> **Last Updated:** 2026-09-29

## Goal

Four small, related UX fixes to `/projects/[id]` identified during a design review (see `docs/specs/project-meeting-notes-collapse.md` for the first fix in this series, the collapsible meeting-notes section):

1. The people roster pill currently makes the *entire pill* a "remove from project" button, with no way to open a person's details. This is inconsistent with the existing pattern in `CircleCard.tsx` (recurring-meeting roster), which already solves this correctly with a separate hover-revealed remove icon.
2. Tasks on the project page are sorted priority-first, due-date-only-as-tiebreak, unlike the rest of the app (dashboard/`/tasks`) which defaults to due-date-first.
3. The project header shows no company name or Notion link, even though both `companyId` and `notionPageId` already exist on the project row.
4. The meetings list is a flat, newest-first list with no way to quickly add a meeting to the project (unlike tasks, which have a "+ משימה" button).

## User Stories

- As Alpir, I want to click a person's name on a project page and see their details, not accidentally remove them from the project.
- As Alpir, I want removing a person from a project to be a deliberate, clearly separate action.
- As Alpir, I want the open tasks on a project page ordered by what's due soonest, with priority only breaking ties.
- As Alpir, I want to see which company a project belongs to, and a quick way to open the project in Notion, right on the project page.
- As Alpir, I want the project's next upcoming meeting to be easy to spot, and a quick way to add a new meeting to the project without leaving the page.

## Acceptance Criteria

**Roster (people pill)**
- [ ] Clicking a person's name/color-dot in the roster opens the existing `PersonModal` (same component used on `/people`) for that person, read/edit as it already behaves there.
- [ ] A separate small "×" control, revealed on hover/focus (matching `CircleCard.tsx`'s `group-hover:opacity-100 focus:opacity-100` pattern), removes the person from the project. It has an `aria-label` naming the person (e.g. "הסר את X מהפרויקט").
- [ ] Clicking the name never triggers removal; clicking "×" never opens the modal.

**Task sort**
- [ ] New `sortTasksByDueThenPriority` in `apps/web/src/lib/sort-tasks.ts`: sorts by nearest due date first (missing due date last), priority breaks ties, id breaks remaining ties. Existing `sortTasksByPriorityThenDue` is untouched (still used elsewhere — `PersonDetailDrawer.tsx`).
- [ ] Project detail page task list uses `sortTasksByDueThenPriority` before grouping; grouping (overdue/upcoming/done/cancelled) is unchanged.
- [ ] Unit tests added alongside the existing ones in `sort-tasks.test.ts`.

**Company + Notion link**
- [ ] `projects.getById` (packages/api) returns `companyName` (left join on `companies`) in addition to existing fields.
- [ ] Project header shows the company name (when `companyId` is set) next to/under the project title.
- [ ] When `notionPageId` is set, header shows a small "פתח ב-Notion ↗" link to `https://www.notion.so/<pageId without dashes>`.
- [ ] Neither element renders when the underlying data is absent (no empty pills/links).

**Meetings: order + quick add**
- [ ] Meetings list on the project page shows upcoming meetings first (ascending by date, then time), followed by past meetings (descending, as already returned by the backend) — computed client-side from the existing `related.meetings` array, no backend change.
- [ ] A "+ פגישה" button next to "+ משימה" in the page header opens `MeetingModal` with `initialValues={{ projectId: id }}`.

## Data Model

No new tables/columns. `projects.companyId` / `projects.notionPageId` already exist in both `schema.ts` and `schema.pg.ts`.

## tRPC API

- `projects.getById` (packages/api/src/routers/projects.ts): output gains `companyName: string | null` via `leftJoin(companies, ...)`. All previously-returned fields are preserved (verified callers: `ProjectModal.tsx`, `projects/[id]/page.tsx`, `conversation-engine.ts`, `cron/pre-meeting-briefing`).
- No other procedure changes. `removePerson`/`addPerson` mutations reused as-is.

## UI Surface

- `apps/web/src/app/projects/[id]/page.tsx` — roster rendering, task sort call, header (company/Notion), meetings ordering, new "+ פגישה" button + `MeetingModal` + `PersonModal` (both dynamic-imported, `ssr: false`, matching existing `ProjectModal`/`TaskModal` pattern).
- `apps/web/src/lib/sort-tasks.ts` / `sort-tasks.test.ts` — new sort function + tests.
- `apps/web/src/lib/notion-url.ts` (new, small) — `notionPageUrl(pageId): string` helper, `+ notion-url.test.ts`.
- No new routes. No changes to `CircleCard.tsx`, `PersonModal.tsx`, or `MeetingModal.tsx` (reused as-is).

## Out of Scope

- Persisting/remembering any UI state across sessions.
- Changing `PersonModal`/`MeetingModal` internals.
- Reworking the meetings list into separate "upcoming"/"past" headed sections (ordering only, for this iteration).
- Fixing the stale color palette in `.cursor/skills/ui-designer-agent/SKILL.md` (separate, non-code housekeeping item, not part of this spec).

## Open Questions

None outstanding — all four items were confirmed with the user before starting.
