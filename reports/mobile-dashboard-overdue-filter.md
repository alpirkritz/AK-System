# mobile-dashboard-overdue-filter

## UI/UX Review

**Verdict:** APPROVED WITH NITS
**Detected stack:** next-trpc-monorepo (change is `apps/mobile` only)

### Design System Checklist
- [x] Matches project tokens (`colors.bg`, `colors.coral`, `colors.accent`, existing `KpiCard` / `FilterChips` / `EmptyState`)
- [x] RTL layout preserved (`row-reverse` chips, Hebrew copy)
- [x] Mobile layout works (chip wraps with the existing row; header title states the filter)
- [x] No unapproved UI frameworks introduced
- [x] Reuses existing components

### UX Quality Checklist
- [x] Clear visual hierarchy — the overdue chip and the title "משימות באיחור" say where you are
- [x] Cognitive load minimized — one new chip, same screen, no new page
- [x] Empty state: "אין משימות באיחור" plus a hint to switch to "פתוחות"
- [x] Destructive actions unchanged (delete still confirms)
- [x] Microcopy matches the dashboard word "באיחור"
- [ ] Touch targets ≥ 44px — the new chip inherits `FilterChips` `minHeight: 36` (`apps/mobile/components/FilterChips.tsx`)

### Findings
- Must-fix: none for this change.
- Nits:
  - The overdue count on the dashboard stays turquoise (`colors.accent`), the same hue as the brand and as "done". The chip and the date label use coral. The number that means "late" does not look late. Suggested swap, not done here: open-tasks count in turquoise, overdue count in coral, meetings stay blue.
  - Could not tap the flow on a device or simulator. `tsc --noEmit` for `@ak-system/mobile` passed, and `apps/mobile/lib/task-due.test.ts` passed (3 tests).

## Product UX gaps (web + mobile)

Proposals only. Not part of the overdue-filter implementation.

### 1. A tap should land on the thing the label promised

The overdue card was the sharp case: the number counted late tasks and the tap opened every open task. The same pattern is still on the web dashboard.

- `apps/web/src/app/page.tsx` around the KPI strip: "משימות פתוחות" and "אירועים ביומן" are static cards. Only "פגישות קרובות" is a link. A count that cannot be opened feels broken next to one that can.
- The same page, quick action "משימה חדשה", links to `/tasks` (the list). The create action is the button on the tasks page and the quick-add control. The dashboard label promises a new task and delivers a list.
- Mobile "פגישות בחלון" opens the full meetings tab, not the window the dashboard just counted.

### 2. Late work is invisible on the web home

The phone dashboard has an overdue count. The web home does not. Open-task rows on the web dashboard show a title and a priority dot, and no due date (`apps/web/src/app/page.tsx`, dashboard open-task row). To see what is late you open tasks and scan dates. Suggested home: an overdue count that links to `/tasks?status=overdue`, and a due date (with "באיחור") on each preview row.

### 3. "היום" means three different lists

- Settings label: "היום ובאיחור" (`apps/mobile/app/settings/dashboard.tsx`).
- Section title: "משימות להיום" (`taskSectionTitle` in `apps/mobile/app/(tabs)/index.tsx`).
- Actual rows: no due date, or due date on or before today (`windowTasks`).

Undated tasks sit inside a section that says "today". Pick one sentence and use it in the setting, the section title, and the filter. Suggested title: "היום, באיחור, ובלי תאריך".

### 4. The phone and the browser are two maps of one system

Web bottom tabs: דשבורד, פגישות, משימות, אנשים, עוזר (`PRIMARY_TABS` in `apps/web/src/components/DashboardLayout.tsx`).
Phone tabs: דשבורד, פגישות, משימות, עוזר, עוד.

אנשים is a primary tab on the phone-sized web app and a row under "עוד" in the native app. זיכרון and סוכנים exist as web routes and as phone rows, and they are absent from the web sidebar. Suggested rule: the five things you open daily are the same five on both clients. Everything else lives under one "עוד" / "מידע" group, with the same Hebrew names.

### 5. One word per concept

- יומן (phone) vs יומן גוגל (web sidebar).
- "Workspaces" in the Hebrew settings list (`apps/mobile/app/(tabs)/more.tsx`). Suggested label: "סביבות עבודה".
- Chips say פתוחות / הושלמו / בוטלו. The row under them says לא התחיל / בתהליך / חסום / בהמתנה. Suggested: keep the rich status on the row, and make the chips a coarser lens with a subtitle so "פתוחות" is obviously "all of these except הושלם and בוטל". Add "באיחור" on the web chips too, so the phone and the browser share the lens.

### 6. One color, one meaning

Turquoise is the brand, the "done" status, and medium priority (`apps/mobile/lib/theme.ts`, and the same hex in `packages/types`). Coral is the open-tasks count, high priority, and errors. Late work, the state that should be easiest to see, is painted in the brand color on the dashboard. Suggested palette roles: turquoise = brand and primary action only; green = done; coral = late or destructive; blue = calendar; amber = blocked. Priority then uses those roles instead of inventing a second turquoise.

### 7. Show the list before the controls

Web `/tasks` puts source chips, status chips, search, project, meeting, and a two-level sort above the work (`apps/web/src/app/tasks/page.tsx`). The phone tasks screen is closer: search, a short chip row, the list, one add button. Suggested web order: title and "משימה חדשה", then status chips including "באיחור", then the list. Search, project, meeting, source, and sort move behind one "סינון" control that shows a count when something is on.

### 8. Small comfort

- Filter chips are 36px tall. Bring them to 44px on the phone.
- Web quick actions are `min-h-[40px]`. Bring the primary one to 44px.
- Empty meetings copy "אין פגישות בחלון" uses the settings word "חלון". Suggested: "אין פגישות בטווח שבחרת" or reuse the section title ("אין פגישות היום").
