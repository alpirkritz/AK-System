# Task Workspaces (מקורות) + Global Quick-Add — Review

## UI/UX Review (pre-implementation, spec)

**Verdict:** APPROVED WITH NITS
**Detected stack:** `next-trpc-monorepo`

Reviewed the UI Surface section of [docs/specs/task-workspaces.md](../docs/specs/task-workspaces.md) against the design system (`apps/web/src/app/globals.css`), the existing task surfaces (`apps/web/src/app/tasks/page.tsx`, `TaskModal.tsx`, `ProjectModal.tsx`), and `DashboardLayout.tsx`.

### Design System Checklist
- [x] Matches project tokens/classes — spec reuses `.btn*`, `.input`, `.select`, `.label`, `.card`, `.overlay`/`.modal`, `.pill`, `.filter-chip`, `.task-row`.
- [x] RTL layout preserved — Hebrew microcopy throughout; FAB placement must respect RTL (see nit below).
- [x] Mobile layout works — FAB explicitly positioned above bottom nav with `env(safe-area-inset-bottom)`; ≥44px target.
- [x] No unapproved UI frameworks introduced — no shadcn/Radix; plain React + Tailwind + existing CSS.
- [x] Reuses existing components — extends `TaskModal`, mirrors `ProjectModal` for `WorkspaceModal`, shared `WorkspacePill`.

### UX Quality Checklist
- [x] Clear visual hierarchy — one primary action per view; quick-add reduces to a single required field (title).
- [x] Cognitive load minimized — advanced fields collapsed under "עוד פרטים"; smart default workspace from `localStorage`.
- [x] Feedback states — loading (existing skeleton), empty ("לא משויך" pill + existing empty state), error (see must-fix), success (brief confirmation on quick-add).
- [x] Destructive action confirmed — workspace delete has explicit Hebrew confirmation clarifying tasks survive.
- [x] Microcopy — verb-first buttons ("הוסף", "שמור", "ביטול"), human Hebrew labels.
- [x] Touch targets ≥44px; `focus-visible`; keyboard navigable; modal focus trap + Escape.

### Findings

**Must-fix**
1. **Quick-add error state is unspecified.** The spec defines success but not failure. Add: on `tasks.create` error, show an inline message inside the modal (reuse the `ProjectModal` error pattern: `text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2`) with copy "לא הצלחנו להוסיף את המשימה. נסה שוב." and keep the modal open with the typed title intact. Do NOT close on error.
2. **FAB must not overlap primary actions or the "עוד" drawer.** On `/tasks`, `/projects` etc. the top-right holds page actions and the `NotificationBell` sits top-left of `main`; the FAB should sit at the **bottom-left** corner (RTL-safe, away from the right-edge scrollbar and page CTAs). On mobile it must sit above the 56px bottom nav (`bottom: calc(56px + env(safe-area-inset-bottom) + 12px)`) and hide while the "עוד" drawer (`moreOpen`) is open to avoid z-index/tap conflicts.

**Nits**
1. **Workspace pill legibility.** Follow the existing colored-tag pattern (background = `color + '22'`, text/border = `color`) rather than the flat `.pill` grey, so the four workspaces are visually distinguishable. Keep the muted default `.pill` only for "לא משויך".
2. **Filter chip pressed tint.** The default `.filter-chip[aria-pressed="true"]` uses the accent teal for all chips. To reinforce per-workspace color, tint the pressed chip with that workspace's color (inline style) while keeping the shared chip shape.
3. **Consistent term.** Use "מקור" everywhere in UI for workspace (not "סביבה"/"workspace"). The settings page title "מקורות", modal title "מקור חדש" / "עריכת מקור", empty option "ללא מקור". Confirm the tasks nav/label copy is not affected.
4. **Quick-add workspace default when none used yet.** If `localStorage` is empty, default to the "Personal" (פרטי) workspace rather than "ללא מקור", so ad-hoc captures still get a sensible home.
5. **Dashboard "משימה חדשה" link.** Optional consistency win (already out of scope): consider later routing it to the quick-add modal instead of `/tasks`. Not required for this spec.

### Microcopy (exact Hebrew)
- FAB `aria-label`: `הוסף משימה`
- Quick-add title placeholder: `מה צריך לעשות?`
- Quick-add disclosure: `עוד פרטים`
- Quick-add submit / cancel: `הוסף` / `ביטול`
- Quick-add success: `נוספה משימה`
- Quick-add error: `לא הצלחנו להוסיף את המשימה. נסה שוב.`
- Workspace select empty option: `ללא מקור`
- Unassigned pill: `לא משויך`
- Workspace delete confirm: `למחוק את המקור? המשימות יישארו אך יאבדו את השיוך.`
- Notion label helper: `למיפוי אוטומטי ממשימות Notion — שם מסד הנתונים או החשבון`

Implementation may proceed. Address the two must-fix items during the Dev stage; the post-implementation UI review will verify them.

---

## Code Review (post-implementation)

**Verdict:** APPROVED WITH NITS
**Detected stack:** `next-trpc-monorepo`
**QA report:** [reports/qa-task-workspaces.md](qa-task-workspaces.md) — PASS
**Static checks:** `pnpm --filter @ak-system/web build` passes (`/settings/workspaces` emitted). `next lint` is blocked by a pre-existing missing ESLint config in `apps/web`; `tsc --noEmit` shows only pre-existing drizzle dual-dialect and missing-`@types` errors.

### Spec conformance

| Spec item | Status |
|---|---|
| `workspaces` table + `tasks.workspaceId` (SQLite + Postgres) | Done — `packages/database/src/schema.ts:60`, `schema.pg.ts:57`, index on both |
| Runtime migration + idempotent seed of 4 workspaces | Done — `packages/database/src/index.ts` (`WORKSPACES_TABLE`, `WORKSPACES_SEED` via `INSERT OR IGNORE`, `ALTER TABLE tasks ADD COLUMN workspace_id`) |
| `workspaces` router (list/getById/create/update/delete) mounted | Done — `packages/api/src/routers/workspaces.ts`, `packages/api/src/index.ts` |
| Delete nullifies `tasks.workspaceId` | Done — `workspaces.ts:59`, covered by test |
| `tasks` create/update accept `workspaceId`; `list` filter; `listByWorkspace` | Done — `packages/api/src/routers/tasks.ts` |
| Notion sync auto-maps by label | Done — `packages/api/src/services/notion-tasks-sync.ts` (`buildWorkspaceLabelMap`, `resolveWorkspaceId`), database name wins over account label |
| Tasks page: source chips + pill per row | Done — `apps/web/src/app/tasks/page.tsx` |
| `TaskModal` source field | Done — `apps/web/src/components/Modals/TaskModal.tsx` |
| Global FAB + quick-add modal | Done — `apps/web/src/components/DashboardLayout.tsx`, `QuickAddTaskModal.tsx`, `.fab` in `globals.css` |
| `/settings/workspaces` + `WorkspaceModal` + settings entry | Done |
| Pill on other task surfaces | Done — project detail, meeting detail, person drawer (`people.getRelated` now joins workspaces) |

### UI review follow-through

Both must-fix items are implemented: quick-add shows an inline error and stays open on failure (`QuickAddTaskModal.tsx`), and the FAB sits bottom-left, lifts above the 56px mobile nav with `env(safe-area-inset-bottom)`, and is hidden while the "עוד" drawer is open. Nits 1–4 are implemented (tinted pill, per-workspace pressed chip tint, consistent "מקור" wording, Personal default). Nit 5 (routing the dashboard "משימה חדשה" link to quick-add) was explicitly out of scope and remains unchanged.

### Findings

**Must-fix** — none.

**Nits**
1. `apps/web/src/app/settings/workspaces/page.tsx:15` fetches the whole task list only to show per-source counts. Fine at current data volume, but a `countByWorkspace` procedure would be cheaper if task volume grows.
2. `packages/database/src/index.ts` builds the seed SQL by string interpolation. Values are hardcoded constants so there is no injection surface, but a prepared statement with bound parameters would be more robust if these ever become user-supplied.
3. `apps/web/src/components/QuickAddTaskModal.tsx:74` implements a local focus trap. Three modals now hand-roll this behaviour; extracting a shared `useFocusTrap` hook would be worth doing next time a modal is added.
4. The `'ws_personal'` default in `QuickAddTaskModal` couples the UI to a seeded id. Harmless today (the id is stable and the code falls back to "ללא מקור"), but a `isDefault` column would express the intent better.
5. `people.ts`, `projects.ts`, `meeting-types.ts` and `facts.ts` still generate ids from bare `Date.now()`. The same collision fixed in `tasks.ts` applies to them; out of scope here, worth a follow-up.

### Security / data safety

- All new procedures are `protectedProcedure`; no new public surface.
- Deleting a workspace nulls the FK rather than cascading, so no task data is lost.
- No PII added to logs; the Notion label is user-supplied config, trimmed and normalized to `null` when blank.
