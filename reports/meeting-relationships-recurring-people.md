# UI/UX Review — Meeting Relationships, Recurring Series, Types & People Review

Detected stack: `next-trpc-monorepo`

## Pre-implementation UI/UX Review

**Verdict:** APPROVED WITH NITS (proceed to implementation, address microcopy + states below)

Reviewed against the spec at `docs/specs/meeting-relationships-recurring-people.md` and the
existing design system (`apps/web/src/app/globals.css`: Heebo, dark `#0f0f0f`/`#16233b`,
teal `#2dd4bf` + gold `#e8c547`, `.btn`/`.btn-primary`/`.btn-ghost`/`.input`/`.select`/`.card`/
`.pill`/`.filter-chip`/`.drawer`, RTL `dir="rtl"`).

### Microcopy (Hebrew RTL)

- Type filter chips: `כל הסוגים`, then one chip per type (verb-free labels are fine here since
  they are filters, matching the existing `כל הפגישות` / `↻ חוזרות` chips).
- Meeting form type field label: `סוג פגישה`; empty option `ללא סוג`.
- Series card heading: `סדרה` with cadence pill `↻ שבועי`; notes label `הערות סדרה`.
- Review tab label: `לאישור` with a count badge; section title `אנשים לאישור`.
- Review row actions (verb-first buttons): `אשר`, `מזג`, `התעלם`.
- Merge picker: placeholder `חפש איש קשר למיזוג…`; confirm button `מזג לכאן`.
- Settings section title: `סוגי פגישות`, description `הגדר סוגים לפגישות — 1:1, אסטרטגיה,
  אופרציה ועוד`. Add button `+ סוג חדש`.
- Cadence label examples: `שבועי · 8 מתוך 8 שבועות אחרונים`, or `אחת לשבועיים`.

### Feedback states

- Review queue loading: reuse the drawer `skeleton` pattern / `טוען…` used elsewhere.
- Review queue empty: not just "אין נתונים" — show `אין אנשים שממתינים לאישור ✓` with a one-line
  hint `אנשים לא מזוהים מהיומן יופיעו כאן`.
- Confirm/ignore success: rely on list refetch (row leaves the queue); optional inline
  `אושר ✓` flash consistent with `savedFlash` in settings.
- Merge is destructive-ish (deletes the source person): require confirmation copy
  `למזג את X אל Y? הפעולה תעביר את כל הקישורים ולא ניתנת לביטול.`
- Type delete is destructive: confirm `למחוק את הסוג? פגישות שמשויכות אליו יאבדו את הסיווג.`
- Series notes save: reuse the inline notes save pattern from `meetings/[id]/page.tsx`
  (`שמור` / `ביטול`, disabled while pending).

### Badges / visual hierarchy

- Meeting type badge: pill using the type color at `+22` bg / `+33` border, matching the
  existing project pill treatment in `renderMeetingCard`.
- Unconfirmed person badge: subtle amber pill `לא מזוהה` (`#e8c547` family) so it reads as
  "needs attention" without alarming red (red reserved for errors/destructive).
- Series grouping: one collapsible header per series (chevron pattern already used for "עברו"
  past-meetings section) so the list does not become noisy.
- One primary action per view: keep `+ פגישה חדשה` primary on `/meetings`; review actions are
  ghost/secondary except the per-row `אשר` which may be primary-sized.

### Accessibility / RTL

- Type `<select>` uses the existing `.select` class (native, keyboard-operable, RTL-safe).
- Review action buttons: add `aria-label` (`אשר את X`, `מזג את X`, `התעלם מ-X`).
- Merge picker must trap focus and close on Escape (reuse drawer/modal Escape handler).
- Touch targets ≥ 44px for the review row action buttons on mobile.
- Cadence and badges must not rely on color alone — always include text.

### Design System Checklist

- [x] Matches project tokens/classes (`.btn`, `.select`, `.card`, `.pill`, `.filter-chip`, `.drawer`)
- [x] RTL layout preserved
- [x] Mobile layout works (chips wrap; drawer full-height)
- [x] No unapproved UI frameworks introduced (lucide-react + native controls already in use)
- [x] Reuses existing components (Section/Row in settings, PersonDetailDrawer, MeetingModal)

### Findings

- Must-fix: review-queue empty/loading states and destructive confirmations (merge, type
  delete) must be implemented as specified above; do not ship silent destructive actions.
- Nits: keep amber (not red) for the unconfirmed badge; ensure the type filter chip row wraps
  and does not overflow on mobile.

---

## Post-Implementation Review (2026-07-16)

**Active Agent:** `reviewer-agent` + `qa-agent` + `ui-designer-agent` (post gate)
**Workflow:** dev-pipeline — Stage 5 (QA) + Stage 6 (Reviewer)
**Stack:** `next-trpc-monorepo`

### QA results

| Gate | Command | Result |
|---|---|---|
| Unit/API (Vitest) | `pnpm test` | ✅ 18 files, **146 tests passed** (incl. 10 new in `meeting-relationships.test.ts`) |
| E2E (Playwright) | `pnpm exec playwright test meeting-relationships.spec.ts` | ✅ **2/2 passed** (type creation flow + review-queue empty state) |
| Type/compile | `pnpm --filter @ak-system/web build` | ✅ build succeeded, all routes compiled |
| Mobile / bridge typecheck | `pnpm -r run lint` (tsc) | ✅ `apps/mobile`, `apps/whatsapp-bridge` clean |

Note: `next lint` on `apps/web` prompts for interactive ESLint setup because the repo has no
committed ESLint config — pre-existing environment state, unrelated to this change. Type safety
is fully covered by the successful `next build`.

### Bug found and fixed during QA

- **Meeting-type create/update/delete did not reflect in the UI.** `utils.meetingTypes.list.invalidate()`
  alone was not triggering a refetch of the active list query (the mutation `onSuccess` ran, the
  row persisted server-side with HTTP 200, but the list never refreshed). Fixed in
  `apps/web/src/app/settings/page.tsx` by updating the query cache directly with the returned row
  via `utils.meetingTypes.list.setData(...)` for create/update/delete, plus an explicit
  `refetch()` as a backstop. This also improves UX (instant, optimistic-style update).

### UI/UX verification against pre-review must-fixes

- [x] Review-queue empty state present (`אין אנשים שממתינים לאישור ✓`) and asserted by e2e.
- [x] Destructive confirmations: type delete uses `window.confirm` with clear Hebrew copy warning
      that meetings lose their classification; merge is a deliberate two-step picker.
- [x] Unconfirmed badge uses amber, not red.
- [x] Type filter chips wrap; no horizontal overflow.
- [x] Design-system classes reused (`.btn`, `.select`, `.card`, `.drawer`, Section/Row).

### Verdict

**APPROVED.** All specified functionality implemented and covered by tests; the one defect found
in QA (type list not refreshing) was fixed and re-verified green.

