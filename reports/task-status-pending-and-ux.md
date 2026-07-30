# Review — `task-status-pending-and-ux`

**Spec:** `docs/specs/task-status-pending-and-ux.md`
**Scope:** `pending` status, DAZ People sync, tasks-screen UX pass

## Verification

| Gate | Command | Result |
|---|---|---|
| Unit / integration | `pnpm test` | **202 passed / 202** (23 files) |
| Tasks-screen e2e | `npx playwright test e2e/ui-refresh.spec.ts` | **5 passed / 5** |
| Build | `pnpm --filter @ak-system/web build` | **Passed** — `/tasks` 5.28 kB |
| Lint | `ReadLints` on all changed files | No errors |

**One false alarm worth recording:** an earlier `pnpm test` run reported 5 failures in
`src/routers/agents.test.ts` ("סוכן לא נמצא"). Cause was environmental, not code — a previous
`source deploy/production.env` in the same persistent shell exported `ABC_ROOT=/data/abc`, which does
not exist on the Mac, so the agent registry resolved to an empty directory. After unsetting the
leaked variables the suite is fully green. No production code was involved.

**Notion API verification** (live, read-only) — the DAZ integration resolves:

- `DAZ Tasks` `cc91f239-0943-8291-a453-012f83de33d6` — `Task name`/`Status`/`Assignee`/`Due`/`Priority`
- `DAZ People` `3031f239-0943-8074-8bf0-d8efb32e9049` — `Name` title, Phone, Email, Linkedin, Company

Every status option in the DAZ database is covered by a test case
(`notion-tasks-sync.workspaces.test.ts`): `Pending`→`pending`, `Not Started`→`not_started`,
`In Progress`→`in_progress`, `Testing`→`in_progress`, `Done`→`done`, `Archived`→`cancelled`.

---

## UI/UX Review

**Verdict:** APPROVED WITH NITS
**Detected stack:** `next-trpc-monorepo`

### Design System Checklist

- [x] Matches project tokens/classes — `.card`, `.filter-chip`, `.checkbox-btn`, `.pill`, `.btn`
- [x] RTL layout preserved — chip DOM order reads right-to-left correctly in Hebrew
- [x] Mobile layout works — chip rows use `flex-wrap`; status-mapping rows stack at `sm:`
- [x] No unapproved UI frameworks introduced
- [x] Reuses existing components — `StatusChips` and `StatusPill` reused unchanged by the mapping screen

### UX Quality Checklist

- [x] Clear visual hierarchy — one primary action (`+ משימה חדשה`) per view
- [x] Cognitive load minimized — `StatusPill` stays silent for the two self-evident states
- [x] Feedback states handled — loading skeleton, empty state with CTA, sync success/error line
- [x] Destructive actions confirmed — none added; cancelling is a Notion-side status, reversible here
- [x] Microcopy: clear Hebrew, verb-first buttons, no raw codes
- [x] Focus-visible and keyboard operable — global `:focus-visible` now applies to every chip

### Must-fix findings — all resolved

**1. Cancelled tasks were filed under "הושלמו" and showed a ✓.**
`apps/web/src/app/tasks/page.tsx:56` filtered on the `done` boolean, which is `true` for both `done`
and `cancelled`. An abandoned task therefore claimed to be completed — the exact opposite of the
intent to keep cancelled work visible.
*Fixed:* a `בוטלו` tab, filtering via `effectiveStatus()` on the rich status, and a **✕** glyph with
the label "שחזר משימה שבוטלה" for cancelled rows.

**2. Priority chips were not keyboard accessible.**
`TaskModal.tsx:308` used `<div onClick>` — no `role`, no `tabIndex`, no `aria-pressed`, and therefore
no focus ring. Unreachable without a mouse, while the adjacent status chips were proper buttons.
*Fixed:* converted to `<button type="button" aria-pressed>`, matching `StatusChips`.

**3. Two statuses would have shared one Hebrew word.**
`blocked` was labelled "ממתין" (literally "waiting"); `pending` naturally wants "בהמתנה". Shipping
both would have made the chip row ambiguous.
*Fixed:* `blocked` → **"חסום"**, `pending` → **"בהמתנה"**. The settings card copy at
`apps/web/src/app/settings/page.tsx:874` was updated to match, so no stale label survives.

**4. Redundant "הושלם" pill.**
`StatusPill` suppressed only `not_started`, so every completed row carried a "הושלם" pill next to an
already-checked box and struck-through title — pure noise in the "הושלמו" and "הכל" views.
*Fixed:* the pill is now silent for `done` as well. Cancelled keeps its pill, since ✕ alone would not
name the state.

### Nits — accepted, not blocking

- **Chip touch targets.** Raised from ~32 px to `min-h-[40px]` on both status and priority chips.
  Still under the 44 px ideal; going further breaks the modal's vertical rhythm. Revisit if the modal
  is ever redesigned.
- **`aria-checked` on cancelled rows.** Reports `true` (it mirrors `done`), while the glyph is ✕. The
  `aria-label` disambiguates, so a screen-reader user is not misled, but the role is an imperfect fit
  for a tri-state control.
- **Filter bar density on small screens.** Four status tabs plus search plus two `min-w-[130px]`
  selects plus the workspace chip row wrap into several stacked rows on a ~375 px viewport, pushing
  content below the fold. Pre-existing, marginally worse with the fourth tab. Suggested follow-up:
  collapse the project/meeting selects behind a "סינון" disclosure on mobile.
- **Palette overlap.** `pending` `#f472b6` sits in the same family as high-priority `#fb7185`. Not a
  new pattern — `in_progress`/low share `#38bdf8` and `done`/medium share `#2dd4bf` — and the two
  dimensions never render as adjacent bare swatches. Contrast on the card background measures
  ≈6.4:1, above AA.

### Accessibility spot-checks

- Contrast on `#141b2e`: `pending` ≈6.4:1, `blocked` ≈7.9:1 — both above the 4.5:1 AA threshold.
- All six status chips expose `aria-pressed`; the tab row exposes `aria-pressed` per tab.
- Chip rows are keyboard-reachable in logical RTL order with a visible ring from the global
  `:focus-visible` rule.

---

## Spec conformance

Every acceptance criterion in the spec is met. No migration was required — `tasks.status` and
`notion_status_overrides.canonical_status` are unconstrained `TEXT`, so widening the enum is a
code-level change only, confirmed by the green suite against the existing SQLite file.

## Deployment note

`deploy/production.env` is git-ignored and does not reach EC2 on its own. `scripts/deploy-ec2.sh`
scp's it and rebuilds; until it runs, production still uses the legacy single-key Notion config and
will not see either DAZ database.
