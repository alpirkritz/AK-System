# Multi-level list sort (Dashboard + Tasks + Meetings)

> **Slug:** `multi-level-sort`
> **Status:** Implemented
> **Last Updated:** 2026-09-07

## Goal

Enable user-chosen two-level sorting (primary + then-by) on Dashboard open tasks, `/tasks` page, and Meetings past/needs-date views. Defaults are defined in Settings (server-side `user_settings`), not hardcoded. Users can override sort on each page for the visit; reset button returns to Settings default.

## User Stories

- As a user, I want to sort my task lists by any field (priority, due date, status, recency) with an optional secondary sort, so I can organize work exactly how I think.
- As a user, I want to set my preferred default sort in Settings once, so every page starts with my choice without re-configuring each visit.
- As a user, I want to temporarily change sort on a specific page and have it stick for that visit, so I can explore different views without losing my Settings default.
- As a user, I want a reset button that returns to my Settings default when I've overridden it, so I can quickly get back to my preferred view.
- As a user, I want the `/tasks` page grouping to follow my chosen primary sort key, so visual organization matches my mental model (priority sections vs date buckets).

## Acceptance Criteria

### Settings UI

- [ ] New section **מיון** in `/settings` with icon, title, and description: "ברירת המחדל לכל רשימה. אפשר לשנות זמנית בדף עצמו."
- [ ] Three rows, each with `ThenBySort` control (two labeled `.select`s):
  - משימות בדשבורד
  - דף משימות
  - פגישות עבר
- [ ] Each row saves immediately on change (mutation); success message: "ברירת המחדל עודכנה"
- [ ] Factory fallback (first visit, no saved prefs):
  - Dashboard: `תאריך יעד (קרוב)` + `עדיפות (גבוהה קודם)`
  - `/tasks`: `עדיפות (גבוהה קודם)` + `תאריך יעד (קרוב)`
  - Meetings past: `תאריך (חדש)` + `ללא`

### List Page Controls

- [ ] Dashboard (open tasks column), `/tasks` filter bar, and Meetings past/needs-date views each show:
  - `מיון:` label + `.select` (primary key)
  - `ואז:` label + `.select` (then-by key or `ללא`)
- [ ] Then-by dropdown hides the currently selected primary field (cannot repeat)
- [ ] When user changes sort on a page, it becomes a **page override** (localStorage) for that visit
- [ ] Ghost button `איפוס לברירת מחדל` appears only when override is active; clicking clears override and re-applies Settings default
- [ ] Link `ברירת מחדל בהגדרות` → `/settings#sort` (optional, for discoverability)
- [ ] Aria labels: `מיון` and `מיון משני` (primary and secondary)
- [ ] Touch targets ≥44px on mobile

### Dashboard Layout

- [ ] Two `.select`s stack vertically under "משימות פתוחות" heading (narrow column)
- [ ] List remains **flat** (no priority/date section headers) — priority color dot on each row
- [ ] Same sort semantics as `/tasks`; display is compact preview widget

### `/tasks` Page Grouping

- [ ] When primary = `עדיפות (גבוהה קודם)` or `עדיפות (נמוכה קודם)`: keep three priority sections; then-by orders rows inside each section
- [ ] When primary = `תאריך יעד (קרוב)` or `תאריך יעד (רחוק)`: flatten priority sections; optionally add date buckets (פג תוקף / היום / השבוע / מאוחר יותר / ללא תאריך); then-by orders within
- [ ] When primary = `סטטוס` or `נוצר`: flatten all sections; then-by orders rows
- [ ] When then-by = `ללא`: stable order by `id` within groups
- [ ] Priority color dot visible on every row regardless of grouping mode

### Meetings

- [ ] Upcoming **קרובות** timeline view: no user sort control (date grouping is the sort)
- [ ] **עבר** and **ללא תאריך** views: same `מיון / ואז` control with meeting fields

### Sort Field Options

**Task fields** (both directions unless stated):
- `עדיפות (גבוהה קודם)` — high → medium → low
- `עדיפות (נמוכה קודם)` — low → medium → high
- `תאריך יעד (קרוב)` — earliest first, missing last
- `תאריך יעד (רחוק)` — latest first, missing last
- `סטטוס (זרימת עבודה)` — workflow order (not_started → in_progress → blocked → done → cancelled)
- `סטטוס (הפוך)` — reverse workflow
- `נוצר (חדשות קודם)` — newest first
- `נוצר (ישנות קודם)` — oldest first

**Meeting past fields**:
- `תאריך (חדש)` — most recent first
- `תאריך (ישן)` — oldest first
- `כותרת (א–ת)` — alphabetical
- `כותרת (ת–א)` — reverse alphabetical
- `פרויקט` — grouped by project name

Then-by always includes: `ללא` (one-key sort)

### Persistence

- [ ] Server: `user_settings.list_sort_prefs` (JSON, shape below) persisted via tRPC
- [ ] Client page overrides: `LS.DASHBOARD_TASKS_SORT`, `LS.TASKS_PAGE_SORT`, `LS.MEETINGS_PAST_SORT` (only when overriding)
- [ ] Legacy migration: if Settings is empty and old `LS.DASHBOARD_TASKS_SORT` is a string (`due_asc`, `priority`, etc.), one-time map into `dashboardTasks` default
- [ ] Saving a new default in Settings **clears that surface's localStorage override** so new default applies immediately

### Empty/Error States

- [ ] No change to existing empty task/meeting states
- [ ] Sort controls remain visible and functional when list is empty (user can set preference)

## Data Model

### Postgres (`packages/database/src/schema.pg.ts`)

```typescript
export const userSettings = pgTable('user_settings', {
  // ... existing columns
  listSortPrefs: text('list_sort_prefs'), // JSON
  // ... existing columns
})
```

### SQLite (`packages/database/src/schema.ts`)

```typescript
export const userSettings = sqliteTable('user_settings', {
  // ... existing columns
  listSortPrefs: text('list_sort_prefs'), // JSON
  // ... existing columns
})
```

### SQLite Bootstrap (`packages/database/src/index.ts`)

```sql
ALTER TABLE user_settings ADD COLUMN list_sort_prefs TEXT
```

### JSON Shape

```typescript
{
  dashboardTasks?: { primary: string, thenBy: string | 'none' },
  tasksPage?: { primary: string, thenBy: string | 'none' },
  meetingsPast?: { primary: string, thenBy: string | 'none' }
}
```

Partial JSON is OK; missing keys use factory fallback.

## tRPC API

### Router: `packages/api/src/routers/settings.ts`

#### New Sub-router: `settings.listSort`

**Procedure: `get`**
- Kind: `query`
- Input: none
- Return shape:
  ```typescript
  {
    prefs: {
      dashboardTasks: { primary: string, thenBy: string },
      tasksPage: { primary: string, thenBy: string },
      meetingsPast: { primary: string, thenBy: string }
    }
  }
  ```
- Auth: `protectedProcedure`
- Notes: Returns parsed JSON from `user_settings.list_sort_prefs`; applies factory defaults for missing keys

**Procedure: `set`**
- Kind: `mutation`
- Input:
  ```typescript
  z.object({
    dashboardTasks: z.object({
      primary: z.enum([...task sort keys]),
      thenBy: z.enum([...task sort keys, 'none'])
    }).optional(),
    tasksPage: z.object({
      primary: z.enum([...task sort keys]),
      thenBy: z.enum([...task sort keys, 'none'])
    }).optional(),
    meetingsPast: z.object({
      primary: z.enum([...meeting sort keys]),
      thenBy: z.enum([...meeting sort keys, 'none'])
    }).optional()
  })
  ```
- Return shape: same as `get` (updated prefs)
- Auth: `protectedProcedure`
- Notes: Patches existing prefs (does not require all three keys); upserts `user_settings` row

### Service: `packages/api/src/services/list-sort-prefs.ts`

- `getListSortPrefs()` → parsed prefs with factory defaults
- `setListSortPrefs(patch)` → upserts and returns merged prefs
- Pattern: sibling of `dashboard-prefs.ts` and `agent-display-names.ts`

## UI Surface

### New Files

- `apps/web/src/lib/sort-keys.ts` — `sortByKeys(items, { primary, thenBy })` comparator, sort key types/constants
- `apps/web/src/components/ThenBySort.tsx` — shared two-select control (מיון / ואז), used on dashboard, `/tasks`, meetings, and Settings
- `packages/api/src/services/list-sort-prefs.ts` — get/set logic for `user_settings.list_sort_prefs`

### Modified Files

- `apps/web/src/app/page.tsx` — replace single sort select with `<ThenBySort>`; flatten list (no sections); load Settings default; handle override
- `apps/web/src/app/tasks/page.tsx` — add `<ThenBySort>` to filter bar; grouping switches based on primary; load Settings default; handle override
- `apps/web/src/app/meetings/page.tsx` — add `<ThenBySort>` to past/needs-date views only
- `apps/web/src/app/settings/page.tsx` — new **מיון** section with three `<ThenBySort>` rows
- `apps/web/src/lib/ls-keys.ts` — add `TASKS_PAGE_SORT`, `MEETINGS_PAST_SORT` (keep `DASHBOARD_TASKS_SORT` for migration)
- `packages/api/src/routers/settings.ts` — add `listSort` sub-router
- `packages/database/src/schema.pg.ts` — add `listSortPrefs` column
- `packages/database/src/schema.ts` — add `listSortPrefs` column
- `packages/database/src/index.ts` — add SQLite ALTER TABLE statement

### Component Structure

```
ThenBySort (props: { surface, value, onChange, fields, showReset, onReset })
├─ Primary select (מיון)
├─ Then-by select (ואז) — filtered options
└─ Optional: איפוס לברירת מחדל button (ghost)
```

## Out of Scope

- Mobile ARO app (`apps/mobile`) — web only
- Server-side ordering of `tasks.list` / `meetings.list` results (still client-side)
- More than two sort keys (no third "ואז עוד")
- Adding a priority field to meetings
- User sort control on upcoming meetings timeline (קרובות stays date-grouped)
- People table sort (already has click-to-sort column headers)
- Sharing one localStorage preference between dashboard and `/tasks` (each surface keeps its own override)
- Deep-linking sort state in URL query params

## Open Questions

None.
