# Review — finance-insights-engine

**Detected stack:** `next-trpc-monorepo`
**Spec:** `docs/specs/finance-insights-engine.md`
**Date:** 2026-08-11
**Verdict:** APPROVED WITH NITS

Full-scope implementation of the spec: a new deterministic trading-journal engine, a deepened
cashflow engine (forecast / anomalies / YoY), a cross-domain overview, a cached Gemini narrative
layer, four agent tools with a once-a-day push, and the UI to show it all.

19 files changed (+1,201 / −19), 13 new files.

## Static checks

| Command | Result |
|---|---|
| `pnpm test` (packages) | **PASS** — 49 files, 632 tests |
| `pnpm test` (apps/web) | **PASS** — 19 files, 150 tests |
| `pnpm --filter @ak-system/web build` | **PASS** — compiled successfully, `/finance` 7.08 kB |
| `pnpm -r run lint` | mobile + whatsapp-bridge PASS (`tsc --noEmit`); `apps/web` **FAIL — pre-existing** (no ESLint config, `next lint` drops into interactive setup) |
| `pnpm e2e` (full) | 8 failed — **all 8 pre-existing**, see below |
| `pnpm e2e` (finance specs) | 3 passed, 2 skipped, 2 failed (both pre-existing) |

Web typechecking is covered by the production build, which passes. `packages/api` has no standalone
`tsconfig.json`, so it is typechecked transitively through that build.

### E2E failures — all pre-existing

The same 8 failures are documented in `reports/qa-dynamic-agent-management.md:62-66` (2026-08-09),
before any of this work existed: `bank-accounts.spec.ts` (1), `full-flow.spec.ts` (2),
`qa-structured.spec.ts` (4), `trading-journal.spec.ts:4` (1).

Two of them were verified directly against a baseline for this review, by stashing
`InsightsTab.tsx` + `TradingJournalTab.tsx` and re-running:

- `finance-insights.spec.ts:4` — clicking the חשבונות tab activates it in the DOM but the URL stays
  at `/finance`, so `toHaveURL(/[?&]tab=accounts/)` times out. Fails identically with this change
  reverted. Root cause is in committed code (`apps/web/src/app/finance/page.tsx:51`,
  `router.replace`), not in this diff.
- `trading-journal.spec.ts:4` — fails on baseline too. With this change applied it gets one line
  further and trips Playwright strict mode on `getByText('P&L ממומש')`, which resolves to two
  nodes: `TradingJournalTab.tsx:117` and `page.tsx:283`. Both are committed lines; this change adds
  no third node (verified by grep).

`task-workspaces.spec.ts:71` and `agent-config.spec.ts` failed in the full run but pass in
isolation — suite interference, not regressions.

## Spec conformance

### מנוע יומן מסחר — matched

- All 11 metrics returned from a pure function over `computeFifoPnl` output —
  `trading-insights.ts:40-56`, computed at `:253-268`. No DB, no LLM in the module.
- `revenge_pattern`, `concentration`, `overtrading` triggers present; thresholds centralised in the
  exported `TRADING_INSIGHT_THRESHOLDS` and referenced by the tests rather than duplicated as magic
  numbers.
- Missing-commission branch produces `data_quality` instead of a fabricated `commission_drag`
  figure, per the data reality check.
- `trading-insights.test.ts` covers zero sells, single sell, unmatched-only, and each trigger.
- `pnl.ts:22` change (exposing `matchedLots` / `buyDate` / `unmatchedQuantity` on `SellRealized`) is
  what makes holding-period and unmatched reporting possible.

### העמקת תזרים — matched

- `forecastNextMonth`, `detectAnomalies`, `yoyComparison` added to `cashflow-analytics.ts` with new
  `InsightKind`s (`anomaly`, `yoy_shift`, `forecast_gap`, `data_quality`) and new entries in
  `INSIGHT_THRESHOLDS` (defaults 2.0 ratio / ₪500 floor as specified).
- `analytics.insights` keeps its signature and now loads 24 months instead of 12 — YoY needs the
  same month a year back, which a 12-month window misses by exactly one month.
- Internal-category exclusion is untouched; the reliability tests still pass.

### שכבה רוחבית — matched

`finance-overview.ts` returns every named field plus explicit `asOf` (`:192`), `valuation: 'cost'`
(`:193`) and `stale` (`:194`, >7 days at `:110`). Pure inputs, no DB — the router loads the rows.

### שכבת נרטיב — matched

- `finance-narrative.ts` follows the `whatsapp-insights.ts` pattern (fenced-JSON strip, retry, text
  fallback) with no DB access; the prompt forbids numbers absent from the supplied facts.
- Caching lives in the router (`finance.ts`, `narrative`) keyed on `(scopeKey, inputHash)`, keeping
  the service DB-free like its siblings.
- A missing `GEMINI_API_KEY` raises `PRECONDITION_FAILED`; `NarrativePanel` shows a quiet error with
  retry while the deterministic cards stay on screen.

### חיבור לסוכנים + פוש — matched, one documented deviation

- Four tools added to `conversation-engine.ts` as thin wrappers; `A_Agents/08_startup_coo.md` now
  lists them and tells the agent to quote figures rather than derive new ones.
- Morning briefing gains an optional finance section, omitted entirely when nothing qualifies.
- **Deviation:** the spec (line 65) says dedupe via `dedupeSlot`. The implementation uses
  `wasNotificationSentToday` + `markNotificationSent` on a new `finance_insight` notification type
  (`finance-alerts.ts:60,75`). `dedupeSlot` belongs to agent *schedules*; "at most one per day" is
  precisely what `wasNotificationSentToday` expresses. Deliberate, and the behaviour the spec asked
  for is preserved.

### UI — matched

`NarrativePanel`, `OverviewStrip`, `TradingMetricCard` under `finance/components/`, all RTL, dark
theme, `.card`/`.btn` classes. `data_quality` insights render in the existing coverage-banner style
on both tabs rather than as normal cards. `TradingMetricCard` carries both a `title` tooltip and
always-visible hint text, and renders `—` with a reason instead of a misleading zero.

## Findings

### Must-fix

None.

### Should-fix

- `TradingJournalTab.tsx:117` / `finance/page.tsx:283` — two nodes rendering `P&L ממומש` keep
  `trading-journal.spec.ts:13` red under Playwright strict mode. Pre-existing and out of this
  change's scope, but this diff is the natural place to have noticed it. Worth a follow-up that
  either scopes the selector or de-duplicates the label.
- `finance/page.tsx:51` — `router.replace` does not move the browser URL in the e2e environment,
  breaking tab deep-linking (`finance-insights.spec.ts:14`). Pre-existing; deserves its own bugfix
  spec since deep links are a stated product behaviour.

### Nits

- `finance.ts`, `analytics.overview` — the USD/ILS rate comes from configuration
  (`configuredUsdIls`) and silently yields `fxExposure: null` when unset. Correct behaviour, but the
  UI could say why the field is blank rather than hiding it.
- Open Question 4 in the spec (₪1,000 push threshold is a guess) stands. `FINANCE_ALERT_MIN_AMOUNT`
  is a named constant, so recalibrating after a couple of weeks is a one-line change.

## Out-of-scope / process

- `apps/web` has no ESLint config, so the lint gate cannot actually run for the web app. Pre-existing
  and already flagged in earlier reports; worth fixing once rather than re-noting each review.
- The spec header still reads `Status: DRAFT — awaiting approval` even though the user approved
  full-scope implementation verbally. Left untouched to avoid editing a PM artifact during review.
- Market-price valuation, per-trade journal enrichment, credit-card connection and mobile parity
  remain out of scope as written.

## Suggested PR description

Expand the `/finance` insights layer from six deterministic cashflow rules into a full hybrid
engine: a new pure trading-journal engine (win-rate, profit factor, expectancy, concentration,
revenge/overtrading patterns) over FIFO realized P&L, cashflow forecasting plus anomaly and
year-over-year detection, a cross-domain overview (capital at cost, runway, savings rate, FX
exposure), and a Gemini narrative layer cached by a hash of the facts that produced it. Every number
is computed in unit-tested pure code with no DB or LLM access; the model only writes prose over
structured `Insight` objects. Exposed to Hugo as four tools and to the user as a once-a-day push for
material `warn`-level findings.
