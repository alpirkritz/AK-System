# Cash Flow Insights — visual income/expense analytics with reduction recommendations

**Detected stack:** `next-trpc-monorepo`
**Status:** DRAFT — awaiting approval
**Author:** PM Agent
**Date:** 2026-08-03

## Goal

Give Alpir a single visual surface on `/finance` that answers three questions about personal cash flow: how much came in and went out over time, what the money was spent on, and where it can realistically be reduced. Modelled on RiseUp's cash-flow-first approach, but built on the transactions already synced from his bank accounts.

## Data reality check (read before scoping)

Measured against the live local DB (`apps/web/data/ak_system.sqlite`, 2026-08-03). These numbers drive several decisions below.

| Fact | Value | Consequence |
|---|---|---|
| `finance_transactions` rows | 206, 100% `source='bank_scrape'` | Enough history (2025-08 → 2026-08) for 12-month trends |
| Rows with a category | **0 of 206** | Category charts are impossible until categorization runs. This is the top prerequisite. |
| Expense rows / distinct descriptions | 127 rows / **41 distinct** | Bank-level granularity: standing orders and transfers, not shopping-level detail |
| Transactions per month | ~16 | Roughly 1/20th of RiseUp-style volume, because that volume lives on credit cards |
| Expense value behind a single monthly credit-card charge | **₪266,646 of ₪786,766 — 34%** | A third of all spending is one opaque line per month. "What did I spend on" cannot be answered for that third. |
| Connected providers | `hapoalim`, `otsarHahayal` — both `accountType='bank'` | Zero credit cards connected. `visaCal` / `isracard` scrapers already exist and are supported. |
| Strong repeating charges | e.g. 26 occurrences avg ₪5,655; 14× ₪7,184; 21× ₪892; 9× ₪17,260 | Recurring-commitment detection is highly effective on exactly this kind of coarse data |

Two conclusions:

1. **Recurring fixed commitments are the highest-value insight for v1**, not grocery-level category breakdown. The data supports the former excellently and the latter poorly.
2. **Connecting `visaCal` / `isracard` is a product prerequisite**, not a nice-to-have, for the "what am I spending on" question. Tracked as Open Question 1.

## User stories

- As Alpir, I want to see income, expenses and net per month for the last 12 months in one chart, so that I can tell whether my cash flow is improving or degrading.
- As Alpir, I want to see a breakdown of the selected month's expenses by category with each category's share, so that I understand where the money goes.
- As Alpir, I want each category compared to its own trailing 3-month average, so that I can see what specifically grew this month rather than just absolute numbers.
- As Alpir, I want a list of my recurring charges with the amount, cadence and annualized cost, so that I can see my fixed monthly commitment load and spot subscriptions worth cancelling.
- As Alpir, I want a short list of concrete, quantified recommendations in Hebrew, so that I know what action would actually save money rather than reading generic advice.
- As Alpir, I want to fix a wrong category on a transaction and have similar transactions follow that decision from then on, so that the charts get more accurate the more I use them.
- As Alpir, I want to be told when the analytics are incomplete and why, so that I never make a decision based on a chart that is silently missing a third of my spending.

## Acceptance criteria

### Categorization

1. **Given** 206 transactions with `category IS NULL`, **when** the user opens the new tab, **then** a banner states the exact number of uncategorized transactions and their share of total expense value, with a primary action `סווג אוטומטית`.
2. **Given** the user triggers `finance.categorizeBacklog`, **when** it completes, **then** every transaction whose description matches a user rule or a built-in keyword rule receives a category, and the response reports how many rows were updated per category and how many remain unmatched.
3. **Given** a bank sync inserts new transactions, **when** the insert happens, **then** the categorizer runs inline so new rows arrive categorized instead of `null`.
4. **Given** the user changes a transaction's category with `applyToSimilar: true`, **when** the mutation completes, **then** a row is created in `finance_category_rules` and all other transactions matching that pattern are updated in the same operation.
5. **Given** a learned rule produces a wrong result, **when** the user opens rule management, **then** the rule is listed and can be deleted, and deleting it does not revert already-categorized transactions.

### Charts

6. **Given** at least 2 months of data, **when** the trend chart renders, **then** it shows one bar pair (income, expense) per month plus a net line, ordered oldest→newest reading right-to-left, for the selected window of 3/6/12 months.
7. **Given** a selected month, **when** the category donut renders, **then** every expense category with a non-zero total appears with its color from `packages/types`, categories under 3% share are grouped into a slice labelled `קטגוריות קטנות`, and the center shows the month's total expense. The grouped slice must **not** be called `אחר`, because `אחר` is already a real category produced by the categorizer's fallback and the two meanings must stay distinguishable.
8. **Given** a category has no data for the selected month, **when** the breakdown list renders, **then** that category is omitted rather than shown as ₪0.
9. **Given** transactions in categories marked as internal movement (`העברות`, `כרטיס אשראי`), **when** any total is computed, **then** those transactions are excluded from income, expense, net and category charts, and the UI states that they were excluded.
10. **Given** a month with zero transactions, **when** the tab renders, **then** each chart shows an empty state with an explanation, not a blank box or a crash.

### Recurring detection

11. **Given** a normalized description appearing at least 3 times in the lookback window with a consistent monthly gap, **when** `finance.analytics.recurring` runs, **then** it is returned with occurrence count, average amount, last amount, last date, cadence and annualized cost.
12. **Given** a recurring charge whose most recent amount exceeds the average of its prior occurrences by more than 10%, **when** the list renders, **then** it is flagged as increased with the percentage.

### Insights

13. **Given** a category whose current-month total exceeds its trailing 3-month average by more than 25% **and** by at least ₪200, **when** insights are computed, **then an** `overspend` insight is returned naming the category, the shekel delta and the percentage.
14. **Given** the DB contains a credit-card charge line but no connection with `accountType='credit_card'`, **when** `finance.analytics.coverage` runs, **then** it reports the hidden share of expenses, and the UI renders it in the top banner with a link to the accounts tab — never as an insight card.
15. **Given** recurring charges in discretionary categories, **when** insights are computed, **then** a `savings_potential` insight returns their combined annualized cost as the headline reduction opportunity.
16. **Given** uncategorized transactions exceed 10% of expense value, **when** the tab renders, **then** the coverage banner states the missing share and every KPI and chart on the screen carries a marker that it is based on partial data.
17. **Given** any insight, **when** it renders, **then** it contains a quantified figure in shekels or percent — no insight is allowed to be purely qualitative.

### General

18. **Given** the user navigates to `/finance?tab=insights`, **when** the page loads, **then** that tab is active, and switching tabs updates the URL so the view is linkable and survives refresh.
19. **Given** any analytics query is loading, **when** the tab renders, **then** skeletons appear within 100ms and no chart renders partial or zero data as if it were real.
20. **Given** `pnpm test` and `pnpm e2e` run, **when** the feature is complete, **then** new Vitest cases cover every aggregation and insight rule, and a Playwright case covers categorize → chart renders → insight appears.

## Data model

Additive only. No existing column changes, no destructive migration.

### New table `finance_category_rules`

Mirror in **both** `packages/database/src/schema.pg.ts` (canonical) and `packages/database/src/schema.ts` (SQLite), plus a bootstrap block in `packages/database/src/index.ts` following the existing `READING_LIST_TABLE` pattern, and table + inferred type exports from `index.ts`.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `pattern` | text NOT NULL | lowercase substring matched against `description` |
| `category` | text NOT NULL | one of the Hebrew labels in `CASHFLOW_CATEGORIES` |
| `direction` | text | nullable — `'income'`/`'expense'` to scope the rule, null = both |
| `created_by` | text NOT NULL | `'user'` or `'builtin'` |
| `created_at` | text NOT NULL | ISO |

Indexes: `idx_finance_category_rules_pattern` on `pattern`.

`finance_transactions` needs **no schema change** — the existing nullable `category` column is the target. Exclusion from analytics is derived from the category value, not stored per row (see Out of scope).

### New shared constants — `packages/types/src/finance.ts`

Exported from `packages/types/src/index.ts`. This replaces the hardcoded `CATEGORIES` array currently living in `apps/web/src/app/finance/page.tsx:13-16`, which must be deleted and imported from here instead.

- `CASHFLOW_CATEGORIES` — ordered list of `{ label, color, kind }` where `kind` is `'expense' | 'income' | 'internal'`. Extends today's 13 labels with `העברות`, `כרטיס אשראי`, `משכנתא`, `הלוואות`, `חיסכון והשקעות`.
- `CATEGORY_COLORS` — label → hex, drawn from the navy palette's chart-safe range; expense categories must remain distinguishable at AA contrast on `#1a2740`.
- `INTERNAL_CATEGORIES` — labels excluded from all analytics totals.
- `DISCRETIONARY_CATEGORIES` — labels eligible for reduction recommendations (`אוכל בחוץ`, `מנויים`, `ביגוד`, and similar), as opposed to fixed commitments.

## tRPC API

All new procedures are `protectedProcedure` in the **existing** router `packages/api/src/routers/finance.ts`, grouped under a new `analytics` sub-router to match the existing `bankConnections` sub-router pattern. No new router file.

| Procedure | Kind | Input | Returns |
|---|---|---|---|
| `finance.analytics.monthlyTrend` | query | `{ months: 3\|6\|12\|24 (default 12) }` | `{ months: [{ month: 'YYYY-MM', income, expense, net }], currency }` |
| `finance.analytics.categoryBreakdown` | query | `{ month: 'YYYY-MM', direction: 'expense'\|'income' (default expense) }` | `{ total, items: [{ category, total, count, share, trailingAvg, deltaAbs, deltaPct }] }` |
| `finance.analytics.recurring` | query | `{ minOccurrences: number (default 3), lookbackMonths: number (default 12) }` | `{ items: [{ label, category, occurrences, avgAmount, lastAmount, lastDate, cadence: 'monthly'\|'irregular', annualizedCost, increasedPct \| null }], monthlyFixedTotal }` |
| `finance.analytics.insights` | query | `{ month: 'YYYY-MM' }` | `{ insights: [{ id, kind: 'overspend'\|'savings_potential'\|'new_recurring'\|'price_increase'\|'commitment_load'\|'savings_rate', severity: 'info'\|'warn'\|'opportunity', title, body, amount \| null, category \| null, href \| null }] }` — data-quality problems are **not** insights and are never returned here; they come from `coverage` below and render once, in the banner |
| `finance.analytics.coverage` | query | none | `{ uncategorizedCount, uncategorizedExpenseValue, uncategorizedShare, oldestUncategorizedDate, creditCardConnected: boolean, hiddenCardValue }` |
| `finance.categorizeBacklog` | mutation | `{ dryRun: boolean (default false) }` | `{ updated, remaining, byCategory: Record<string, number> }` |
| `finance.setTransactionCategory` | mutation | `{ id: string, category: string, applyToSimilar: boolean (default false) }` | `{ updated, ruleCreated: boolean }` |
| `finance.analytics.listCategoryRules` | query | none | `{ rules: [{ id, pattern, category, direction, createdBy, createdAt }] }` |
| `finance.analytics.deleteCategoryRule` | mutation | `{ id: string }` | `{ ok: true }` |

Reuse, do not duplicate: `finance.getSummary` already returns current-month `monthlyIncome` / `monthlyExpenses` / `monthlyNet` and stays the source for the page-level cards. `monthlyTrend` must produce identical figures for the current month once internal categories are excluded — this is a required Vitest assertion.

### Services

- **New** `packages/api/src/services/transaction-categorizer.ts` — extract the existing keyword logic from `packages/api/src/services/csv-parser.ts:156-171` (`categorize()`) into a shared module that applies user rules from `finance_category_rules` first, then built-in keywords. `csv-parser.ts` imports from it instead of holding its own copy.
- **New** `packages/api/src/services/cashflow-analytics.ts` — pure functions for monthly aggregation, category breakdown with trailing averages, recurring detection (description normalization, cadence from median day-gap), and the insight rule engine. Pure and dependency-free so it is unit-testable without a DB, following the precedent of `pnl.ts`.
- **Modify** `packages/api/src/services/bank-sync-service.ts` — call the categorizer on insert instead of writing `category: null`.

### Insight rules (deterministic — no LLM in v1)

| Rule | Trigger | Output figure |
|---|---|---|
| `overspend` | category month total > trailing 3-mo avg × 1.25 **and** delta ≥ ₪200 | shekel delta + % |
| `new_recurring` | recurring charge whose first occurrence is within 60 days | monthly + annualized cost |
| `price_increase` | last amount > mean of prior occurrences × 1.1 | old → new + % |
| `commitment_load` | monthly fixed recurring total ÷ trailing 3-mo avg income | % of income committed |
| `savings_rate` | net ÷ income for month and trailing 3 months | % + direction of change |
| `savings_potential` | sum of annualized cost of recurring charges in `DISCRETIONARY_CATEGORIES` | annual shekels |

Data-quality conditions — uncategorized share above 10%, and a card charge with no connected credit card — are returned by `finance.analytics.coverage`, not by `insights`. They are rendered exclusively in the top banner so the same message never appears twice on one screen.

LLM-generated narrative is deliberately excluded: these rules are auditable, free, deterministic and testable, and the repo has no precedent for LLM output inside the finance UI.

## UI surface

### Route and tab

No new route. New tab in `apps/web/src/app/finance/page.tsx`, added to the `Tab` union (line 11) and the tab bar (lines 286-293):

- Label `תזרים ותובנות`, icon `📈`, id `insights`.
- **Placed first, and becomes the default tab**, replacing `accounts`. Rationale: this is the content-first landing surface for the finance page; accounts is configuration and balance-checking, so it moves to second position.
- **First-run state.** Because all 206 transactions are currently uncategorized, the very first load of the new default tab would otherwise show a screen of empty charts. When coverage is zero, the tab must instead render a single onboarding card — headline `בוא נבין על מה הכסף הולך`, one line explaining that {n} transactions are waiting to be categorized, and one primary button `סווג אוטומטית` — with no charts rendered at all. Charts appear only once at least one categorized transaction exists.
- Tab state moves from `useState` to `useSearchParams` + `router.replace` so `?tab=insights` is linkable and survives refresh. This also fixes the existing behaviour where refreshing `/finance` always resets to accounts.

### New components under `apps/web/src/app/finance/`

| File | Responsibility |
|---|---|
| `InsightsTab.tsx` | Lazy-loaded tab shell: month selector, KPI row, charts, insights, recurring list |
| `components/MonthlyTrendChart.tsx` | Income/expense bars + net line, 3/6/12-month window toggle |
| `components/CategoryDonut.tsx` | Selected-month expense donut, total in center |
| `components/CategoryBreakdownList.tsx` | Rows: color dot, category, total, share bar, delta vs trailing average |
| `components/RecurringList.tsx` | Recurring charges with cadence, annualized cost, increase flag |
| `components/InsightCard.tsx` | One insight: severity accent, title, body, figure, optional action link |
| `components/CategorizeDrawer.tsx` | Right drawer to categorize uncategorized transactions and manage learned rules |
| `lib/format.ts` | Extract the existing `fmt` / `fmtDate` from `page.tsx:18-35` for shared use |
| `lib/chart-scale.ts` | Pure SVG chart helpers: linear scale, nice ticks, `describeArc` |

Reuse without modification: `SummaryCard.tsx` for the KPI row, and the existing `.card`, `.btn`, `.btn-ghost`, `.filter-chip`, `.toggle-btn`, `.drawer` / `.drawer-backdrop`, `.skeleton`, `.pill`, `.table-*` classes from `apps/web/src/app/globals.css`. No new global CSS.

### Layout, top to bottom

1. **Coverage banner** — only when coverage is imperfect. States the uncategorized count and share, or the credit-card blind spot, with one primary action each.
2. **Month selector** — previous/next arrows plus the month name; defaults to the current month.
3. **KPI row** — `SummaryCard`s for הכנסות, הוצאות, and נטו (green/coral by sign). **שיעור חיסכון is shown only when coverage is clean** — no uncategorized transactions above the 10% threshold and no unclassified transfers. On today's data the trailing year nets to roughly ₪-105k, which would render a large negative savings rate as the headline number before any transfer classification has happened. A wrong, demoralizing headline figure is worse than an absent one, so until coverage is clean the fourth card shows `שיעור חיסכון` with a `—` value and the subtext `זמין אחרי סיווג התנועות`.
4. **Trend chart** — full width, with the 3/6/12 window toggle.
5. **Two-column** (single column under `md`): donut on one side, category breakdown list on the other.
6. **Insights** — cards ordered `opportunity` → `warn` → `info`, capped at 6 with a show-more.
7. **Recurring commitments** — table with the monthly fixed total in the header.

### Charting approach — hand-rolled SVG, no new dependency

**Decision (user, 2026-08-03): no chart library.** Charts are hand-rolled SVG components. This keeps the bundle unchanged, gives full control over RTL and the navy palette, and avoids a dependency for what amounts to three chart types.

Consequences the implementation must absorb, since a library would otherwise have provided these:

- **Responsiveness.** No `ResponsiveContainer`. Each chart renders into a `viewBox` with `preserveAspectRatio` and scales via CSS width 100%, so no resize observer or client-side measurement is needed. Fixed aspect ratios per chart, taller on mobile for the trend chart.
- **Scales.** A small shared helper in `apps/web/src/app/finance/lib/chart-scale.ts` — linear scale, nice-rounded tick values, and a `describeArc` helper for donut segments. Pure functions, unit-tested in `apps/web`.
- **Tooltips.** No library tooltip. Trend chart: each month is a `<g>` with a transparent full-height hit rect; the active month's values render in a fixed caption row above the chart rather than a floating popover. This is deliberately simpler than a floating tooltip and works identically on touch and mouse.
- **Donut.** Rendered as SVG `<path>` arcs via `describeArc`, not `<circle>` with `stroke-dasharray`, so segment borders and hover offsets stay controllable.
- **Axes.** Month labels as plain `<text>` under the bars, right-to-left order handled by reversing the data array — no axis component needed.

Chart components stay presentational: they receive already-aggregated arrays and never call tRPC or compute business figures.

Constraints on use:

- All colors come from `CATEGORY_COLORS` and the navy tokens.
- Values must be Hebrew and shekel-formatted via `lib/format.ts`, and readable on touch without hover.
- Axes read right-to-left.
- Any transition is disabled under `prefers-reduced-motion`.
- Every chart carries `role="img"` and an `aria-label` summarizing the same figures in words, because color is otherwise the only encoding. The category breakdown list adjacent to the donut is the accessible, screen-readable equivalent of that chart and is therefore not optional.
- Clicking a month's bar in the trend chart selects that month everywhere on the tab, so the chart doubles as navigation and the relationship between the two time controls is discoverable.
- Month prev/next controls and month hit areas are at least 44×44px.

### Microcopy (Hebrew, final strings)

| Surface | Text |
|---|---|
| Tab label | `תזרים ותובנות` |
| Coverage banner — uncategorized | `ל-{n} תנועות אין קטגוריה ({pct}% מההוצאות). הפילוח חלקי עד שיסווגו.` / action `סווג אוטומטית` |
| Coverage banner — card blind spot | `{pct}% מההוצאות מוסתרות מאחורי חיוב אשראי אחד. חבר את כרטיס האשראי כדי לראות על מה באמת יצא הכסף.` / action `חבר כרטיס` |
| Empty month | `אין תנועות בחודש הזה.` |
| Empty recurring | `לא זוהו חיובים קבועים. צריך שלושה חיובים דומים לפחות כדי לזהות תבנית.` |
| Categorize drawer title | `סיווג תנועות` |
| Apply-to-similar checkbox | `החל על תנועות דומות בעתיד` |
| Rule delete confirm | `למחוק את הכלל? תנועות שסווגו כבר יישארו כפי שהן.` |
| Excluded note | `העברות פנימיות וחיובי אשראי לא נכללים בסכומים, כדי למנוע כפל ספירה.` |

## Credit-card ingestion — decision

The blind spot is 34% of expense value. Three routes exist; they are not equivalent.

### What already exists

- **Scrapers** for `visaCal` and `isracard` are already wired into `bank-sync-service.ts` and the add-connection modal. Nothing to build — only credentials to enter. Cal needs username + password; Isracard needs ID + last 6 card digits + password.
- **CSV import** already has explicit column maps for `Max / כאל`, `Isracard / ויזה` and `Cal / ויזה כאל` in `packages/api/src/services/csv-parser.ts:50-73`.
- **PDF import** already exists: `packages/api/src/services/pdf-parser.ts` extracts text with `pdf-parse` and parses Visa Cal statements with two strategies (whitespace columns, then date/amount regex per line).

So all three routes are technically live today. The difference is data quality, not feasibility.

### Recommendation: connect the scrapers; keep file import as a history backfill

The scraper route is preferred for the primary flow because the analytics surface depends on data staying current without a monthly ritual, and because only the scraper produces the three things the charts need:

1. **A `dedupe_key`**, so a re-sync is idempotent. The file importers do **not** set one (`importCSV` in `packages/api/src/routers/finance.ts:137-166` inserts unconditionally), which means re-importing a statement silently duplicates every transaction in it and corrupts every total on this new tab. Fixing that is a prerequisite for the file route, not a given.
2. **A `bank_account_id`**, so card transactions are attributable to a card and the bank-side lump charge can be excluded without excluding the card's own detail. File imports leave it null.
3. **`installment_info` and `txn_status`**, which materially change monthly totals for Israeli cards and are absent from both file parsers.

The file route stays valuable for one specific thing: the scrapers reach only about 12 months back, so downloaded statements are the only way to load older history. Downloaded **CSV is preferred over PDF** — the CSV column maps already exist and are deterministic, whereas the PDF path reconstructs columns from a flat text blob and breaks whenever the issuer adjusts the layout.

### Prerequisites if the file route is used at all

These are required before any file-imported card data is allowed into the analytics aggregations:

- Compute and store a `dedupe_key` in `importCSV` / `importPDF` using the same `sha256(account|date|amount|description)` scheme as `bank-sync-service.ts`, and skip existing keys.
- Fix `packages/api/src/services/csv-parser.ts:231` — `direction = parseAmount(raw) < 0 ? 'expense' : 'expense'` returns `'expense'` on both branches, so credit-card refunds and credits are recorded as expenses and inflate every expense total. `pdf-parser.ts:113` hardcodes `direction: 'expense'` with the same effect.
- Unify categorization: `categorize()` is currently duplicated verbatim in `csv-parser.ts:156-171` and `pdf-parser.ts:46-61`. Both must be replaced by the single `transaction-categorizer.ts` module described above.
- Let the user attach an imported file to a specific card account so `bank_account_id` is populated.

Automatic folder watching is out of scope; if the user drops statements into a folder, the existing `expense-folders.ts` pattern used by VAT bulk import is the precedent to follow in a later iteration.

## Out of scope

- Budgets, spending targets, savings goals, and any "you have ₪X left to spend this month" mechanic.
- LLM-written insight narratives.
- A mobile (`apps/mobile`) screen for this feature.
- Unifying the business VAT ledger (`vat_entries`) with personal cash flow — they stay separate domains.
- Per-transaction "exclude from analytics" toggle; exclusion is derived from category only in v1.
- Splitting one transaction across multiple categories.
- Net-worth history, forecasting, or projected end-of-month balance.
- Changing the existing `getSummary`, portfolio, journal, VAT or import tabs beyond deleting the duplicated `CATEGORIES` array and extracting `fmt`.
- Automatic credit-card connection setup — the user connects it through the existing accounts tab.

## Open questions

1. ~~**Connect `visaCal` / `isracard`?**~~ **Resolved 2026-08-03:** see the Credit-card ingestion section. Scraper connection is the recommended primary route, downloaded CSV is the history-backfill route, PDF is the last resort. The sync bug that previously blocked this is fixed — both bank connections now report `connected` with a successful sync and no error. Remaining action is the user entering card credentials.
2. **Once cards are connected, confirm the double-count rule.** The bank's monthly card charge and the individual card transactions would both exist. The spec's answer is to categorize the bank-side charge as `כרטיס אשראי` and exclude it from totals, counting only the itemized card transactions. Confirm this is the intended reading.
3. **Which categories are discretionary?** The default proposal is `אוכל בחוץ`, `מנויים`, `ביגוד` as reducible, with `משכנתא`, `שכירות`, `ביטוח`, `חשבונות`, `חינוך` treated as fixed. Reduction recommendations only ever target the discretionary set.
4. **Is the ~₪65k monthly expense figure real spending, or does it include transfers between the two accounts and to investments?** No same-day matching income/expense pairs were found, so no double-counting is confirmed, but the figure is high enough that classifying transfers correctly will materially change every chart.
