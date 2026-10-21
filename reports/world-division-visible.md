# Review — world-division-visible

**Date:** 2026-10-21
**Spec:** `docs/specs/world-division-visible.md`
**QA:** `reports/qa-world-division-visible.md`

## Verdict: APPROVED WITH NITS

## UI/UX Review — APPROVED WITH NITS

- **One control.** The switcher sits in the header row next to the notification bell (`DashboardLayout`). Resting label is «הכל». A picked world is stored in `localStorage["ak.worldFilter"]` and the same id is sent to tasks, meetings, projects, people, and the dashboard. The page-local «מקור» chips and the people «כל העולמות» row are gone.
- **Filtered reminder.** `FilteredWorldChip` reads «מסונן: {name} ✕» and clears the filter. It uses `.filter-chip` with a 44px minimum height.
- **Phone vs desktop.** Under 768px the chip opens a bottom sheet above the tab bar. At 768px and up it opens a popover. Both list «הכל», then each world, with workspaces indented. Playwright at 390px confirms the chip is visible and the people page does not scroll sideways.
- **Badges.** Task rows, meeting cards, and project cards use `WorldBadge` (dot + name, «לא משויך» when empty, `{world} · {workspace}` for a child). People keep the existing affiliation badges and show no badge when they have none.
- **לא משויך.** While a filter is on, tasks, meetings, projects, and people with no world stay in the list under that heading. «הכל» is one list with no heading.
- **Words.** Task, quick-add, batch, project, and meeting pickers say «עולם» and offer «ללא עולם». Settings calls the page «עולמות». The Notion people-database section on that page keeps its own wording.
- **RTL / dark / design system.** New controls use `.filter-chip`, `.select`, and the existing dark palette. Copy is short Hebrew.
- Nit: switcher options are `role="option"` with `aria-selected`. `aria-pressed` was removed because that attribute is not valid on `option`.

## Spec conformance

| Area | Status |
|---|---|
| Header switcher, persistent id, stale id cleared | ✅ `WorldSwitcher.tsx`, `world-filter.tsx` |
| Lists include expanded ids plus null workspace | ✅ `tasks.list`, `meetings.list`, `projects.list` |
| People: affiliated ids plus zero affiliations, affiliated first | ✅ `people.listPaginated`, `personIdsInWorkspace` |
| `meetings.setWorkspace` sets `manual` or clears both | ✅ `meetings.ts`, Vitest |
| Project create/update `workspaceId` | ✅ `projects.ts`, `ProjectModal.tsx` |
| No rename, reparent, or backfill | ✅ no migration |

## Checks

| Command | Result |
|---|---|
| Vitest, 3 files, 47 tests | Pass |
| Playwright, 2 specs, 8 tests | Pass |
| ESLint on the touched web files | 0 errors. Remaining warnings are pre-existing (`calEvents` deps, `<img>`, people-table `aria-checked`). |
| `pnpm --filter @ak-system/web build` | Pass |
| Full `tsc --noEmit` | Still exits 2. Many errors are pre-existing. Passing `{ workspaceId }` into `useQuery` surfaces `unknown` on dashboard rows because the router output does not infer through tRPC. `next.config.js` sets `typescript.ignoreBuildErrors`. |

## Nits

- Meeting and project pickers are covered by Vitest, not by Playwright.
- The full `pnpm test` / `pnpm e2e` suites were not re-run in this pass.
