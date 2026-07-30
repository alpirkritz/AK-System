# Spec — `pending` status, DAZ people sync, and tasks-screen UX pass

**Slug:** `task-status-pending-and-ux`
**Stack:** `next-trpc-monorepo`
**Depends on:** `docs/specs/notion-workspace-mapping.md` (rich statuses already shipped)

## Goal

Three connected changes:

1. Add a sixth canonical task status, `pending`, so Notion's `Pending` no longer collapses into "לא התחיל".
2. Connect the DAZ **People** Notion database so tasks assigned to DAZ teammates are kept instead of skipped.
3. UX pass on the tasks screen so day-to-day work is effortless — driven by the `ui-designer-agent` review.

## 1 — `pending` status

### Why

The DAZ Tasks database exposes `Pending / Not Started / In Progress / Testing / Done / Archived`.
`Pending` currently falls through the keyword heuristic to `not_started`, which loses the distinction
between "haven't picked it up" and "waiting on something".

### Label collision (must fix)

`blocked` is currently labelled **"ממתין"** — literally "waiting". Adding a `pending` status labelled
"בהמתנה" would produce two near-identical Hebrew labels. Per the *one term per concept* rule,
`blocked` is relabelled to **"חסום"** and `pending` takes **"בהמתנה"**.

### Data model

`TASK_STATUSES` becomes:

```
not_started | pending | in_progress | blocked | done | cancelled
```

No migration is required: `tasks.status` is a plain `TEXT` column with a default and **no CHECK
constraint**, and `notion_status_overrides.canonical_status` is likewise unconstrained. Adding a value
is purely a code-level change. `done` derivation is unchanged — only `done` and `cancelled` set the
boolean.

### Presentation

| Status | Label | Color | Rationale |
|---|---|---|---|
| `not_started` | לא התחיל | `#7a89ab` | unchanged |
| `pending` | בהמתנה | `#f472b6` | rose — distinct hue at pill size from grey-blue, sky, amber, teal, purple |
| `in_progress` | בתהליך | `#38bdf8` | unchanged |
| `blocked` | **חסום** | `#f59e0b` | relabelled to free "ממתין" |
| `done` | הושלם | `#2dd4bf` | unchanged |
| `cancelled` | בוטל | `#9a7bc4` | unchanged |

Chip order is the canonical order above (lifecycle order, left→right in RTL source order).

### Heuristic changes

`guessCanonicalStatus` splits the old catch-all `blocked` bucket:

- **pending** ← `pending`, `awaiting`, `waiting`, `on hold`, `hold`, `paused`, `בהמתנה`, `ממתין`, `מושהה`
- **blocked** ← `block`, `blocker`, `stuck`, `חסום`, `תקוע`
- **in_progress** additionally ← `testing`, `בבדיקה` (DAZ's `Testing` is an active phase)

`pending` is evaluated before `blocked`; the `not_started` family still precedes `in_progress` so
"Not started" is not captured by `started`.

Behaviour change: `Waiting` now guesses `pending` instead of `blocked`. Existing user overrides in
`notion_status_overrides` still win, so no stored mapping is disturbed.

## 2 — DAZ People database

Add to `NOTION_ACCOUNTS` in `deploy/production.env` and `apps/web/.env.local`, under the `DAZ` account:

```
{"id":"3031f239-0943-8074-8bf0-d8efb32e9049","name":"DAZ People","type":"people"}
```

Effect: DAZ teammates (Or Zelniker, Dor Perez, …) enter the people directory, so their tasks satisfy
the sync's "assignee is known" test and are imported rather than skipped. Previously only tasks
assigned to Alpir Kritzler survived.

**Privacy note:** this imports DAZ contacts into the CRM. Explicitly requested by the user.

## 3 — Tasks screen UX

### Finding A — cancelled tasks are filed under "הושלמו" (must fix)

`done` is `true` for both `done` and `cancelled`, and the filter tabs test the boolean. A cancelled
task therefore appears under **"הושלמו"** and renders a **✓** checkbox — telling the user it was
completed when it was abandoned. This directly contradicts the intent of keeping cancelled tasks
visible.

Fix:

- Filter tabs become **פתוחות / הושלמו / בוטלו / הכל**, evaluated on the effective status
  (`t.status ?? (t.done ? 'done' : 'not_started')`) rather than the boolean.
  - `פתוחות` — anything not `done` and not `cancelled` (includes `pending`, `blocked`)
  - `הושלמו` — `done` only
  - `בוטלו` — `cancelled` only
- The row checkbox renders **✕** for `cancelled` and **✓** for `done`, with matching `aria-label`.

### Finding B — chip touch targets below 44px (nit, fixing)

Status and priority chips are `py-1.5` ≈ 32px tall. Raise both to a `min-h-[40px]` target — the
practical maximum without breaking the modal's vertical rhythm.

### Finding C — priority chips are not keyboard accessible (must fix)

`TaskModal` priority chips are `<div onClick>`: no `role`, no `tabIndex`, no `aria-pressed`, no focus
ring. Convert to `<button type="button" aria-pressed>` matching `StatusChips`.

### Out of scope

- Grouping or sorting the task list by status (priority grouping stays).
- A status filter on the tasks screen beyond the four tabs.
- Writing status changes back to Notion (still read-only, per the parent spec).

## Acceptance criteria

- [ ] `pending` is selectable in the task modal and in the Notion status-mapping screen.
- [ ] A Notion `Pending` label syncs to status `pending`, not `not_started`; `Testing` → `in_progress`.
- [ ] `blocked` reads "חסום" everywhere; no two statuses share a Hebrew label.
- [ ] Cancelled tasks appear under "בוטלו", never under "הושלמו", and show ✕ not ✓.
- [ ] DAZ teammates' tasks import after a sync.
- [ ] Priority chips are reachable and operable by keyboard with a visible focus ring.
- [ ] `pnpm test` green; `pnpm --filter @ak-system/web build` green.

## Files

| File | Change |
|---|---|
| `packages/database/src/schema.ts` / `schema.pg.ts` | add `pending` to `TASK_STATUSES` |
| `packages/types/src/index.ts` | order, color, labels (`blocked` → חסום) |
| `packages/api/src/services/notion-tasks-sync.ts` | `CanonicalStatus`, `guessCanonicalStatus` buckets |
| `apps/web/src/app/tasks/page.tsx` | cancelled tab, status-based filtering, ✕ checkbox |
| `apps/web/src/components/StatusChips.tsx` | touch target |
| `apps/web/src/components/Modals/TaskModal.tsx` | priority chips → buttons, touch target |
| `deploy/production.env`, `apps/web/.env.local` | DAZ People database |
| `packages/api/src/services/notion-tasks-sync.workspaces.test.ts` | heuristic cases |
