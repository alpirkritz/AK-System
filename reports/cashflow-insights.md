# Cash Flow Insights — review log

Spec: `docs/specs/cashflow-insights.md`

## UI/UX Review (pre-implementation)

**Verdict:** APPROVED WITH NITS — after the four must-fix items below were applied to the spec
**Detected stack:** `next-trpc-monorepo`
**Reviewer:** UI/UX Designer Agent
**Date:** 2026-08-03
**Scope:** spec-level review of the UI Surface section. No code exists yet.

### Design System Checklist

- [x] Matches project tokens/classes — navy `#0e1626`, surface-card `#1a2740`, accent `#2dd4bf`, coral `#fb7185` expense, `#34d399` income
- [x] RTL layout preserved — explicit right-to-left axis requirement on charts
- [x] Mobile layout works — two-column collapses to one under `md`; tap tooltips and 44px targets specified
- [x] Reuses existing components — `SummaryCard`, `.card`, `.btn`, `.filter-chip`, `.toggle-btn`, `.drawer`, `.skeleton`, `.table-*`; no new global CSS
- [x] No unapproved UI frameworks introduced — user chose hand-rolled SVG charts; zero new dependencies

### UX Quality Checklist

- [x] Clear visual hierarchy — one primary action per state (`סווג אוטומטית` or `חבר כרטיס`)
- [x] Cognitive load minimized — after fix F2, the two time controls are linked rather than competing
- [x] All feedback states handled — loading skeletons, empty month, empty recurring, first-run onboarding, partial-data marker
- [x] Destructive actions require confirmation — rule deletion confirms and clarifies that existing categorizations are kept
- [x] Microcopy — verb-first buttons, quantified Hebrew errors, no raw codes
- [x] Touch targets ≥44px; charts have `role="img"` + `aria-label`; breakdown list is the accessible equivalent of the donut

### Must-fix findings (all applied to the spec)

**F1 — `אחר` collision in the donut.** The original spec grouped sub-3% slices into `אחר`, but `אחר` is already a real category, produced as the fallback of `categorize()` in `packages/api/src/services/csv-parser.ts:170`. Two different meanings would have merged into one slice, and a user clicking it would get an incoherent transaction list. Violates *one term per concept*. Fixed: the grouped slice is now `קטגוריות קטנות`, explicitly distinct from the `אחר` category.

**F2 — the same message rendered twice.** `coverage` and `blind_spot` were both insight kinds returned by `finance.analytics.insights` *and* the content of the top banner, so the identical warning would have appeared twice on one screen. Violates *deference* — chrome repeating itself instead of serving content. Fixed: data-quality conditions now come only from `finance.analytics.coverage` and render only in the banner; `insights` returns behavioural findings exclusively.

**F3 — a wrong headline number on first load.** The KPI row included `שיעור חיסכון` unconditionally. On the live data the trailing year nets to roughly ₪-105k, so before transfers are classified the headline would read as a large negative savings rate. That is both demoralizing and probably factually wrong, and a headline KPI is the single most trusted number on the screen. Fixed: the card renders `—` with the subtext `זמין אחרי סיווג התנועות` until coverage is clean.

**F4 — empty charts as a landing page.** The spec makes this tab the default for `/finance` while all 206 transactions are uncategorized, so the first load would have been a screen of empty chart frames. Violates *content first* and wastes the one moment where intent is highest. Fixed: a zero-coverage first-run state renders a single onboarding card with one primary action and no charts at all.

### Nits and follow-ups

**N1 — recurring recommendations have no acknowledgement path.** The `savings_potential` insight will keep recommending the same subscription every month even after a deliberate decision to keep it. There is no data model for dismissal in v1, so this is accepted for now, but it will become noise by the second or third month. Suggested follow-up: a `dismissedAt` on a future recurring-charge table, or a lightweight "keep" list.

**N2 — insight ordering needs a tiebreak.** Ordering is `opportunity` → `warn` → `info`, but multiple `overspend` insights can tie. Recommend a secondary sort by absolute shekel amount descending, so the most expensive finding is always first.

**N3 — hand-rolled charts shift risk from RTL to responsiveness.** With the user's decision to avoid a chart library, the RTL concern largely disappears — reversing a data array is trivial compared to fighting a library's axis direction. The risk moves to layout: without a `ResponsiveContainer` the charts must be `viewBox`-based and scale purely through CSS, and the trend chart must stay legible at ~360px with 12 months of bars. Recommend implementing the trend chart at the narrowest breakpoint first and only then widening, rather than the reverse. Also recommend a fixed caption row for the selected month's values instead of a floating tooltip — it removes the hover/touch divergence entirely, and is now specified.

**N4 — the donut is the weakest element on this dataset.** With 34% of expense value in a single `כרטיס אשראי` slice, the donut mostly visualizes the blind spot rather than spending behaviour. It is still correct to build, but the category breakdown list carries more of the actual insight, and should get the more prominent position of the two columns until credit cards are connected.

### Note on the skill reference file

`.cursor/skills/ui-designer-agent/SKILL.md` documents the design system as background `#0f0f0f` with a gold `#e8c547` accent, and lists a `.btn-danger` class. All three are stale. The shipped system is navy `#0e1626` with turquoise `#2dd4bf` (migrated by `docs/specs/ui-refresh-navy.md`), and `.btn-danger` does not exist in `apps/web/src/app/globals.css` — destructive actions use `.btn.btn-ghost` with inline coral. Reviews run against the skill file as written would apply the wrong tokens. Worth correcting the skill file separately.
