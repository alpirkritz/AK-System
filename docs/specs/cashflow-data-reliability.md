# Spec: Cashflow insights data reliability

**Detected stack:** `next-trpc-monorepo`  
**Status:** APPROVED (open questions resolved 2026-08-04)

## Goal

Make Finance cashflow KPIs, category totals and insights trustworthy and explainable: every number on `/finance` must have a clear definition, the same month rules everywhere, and visible attribution when bank-only data hides most real spending behind excluded credit-card settlements. Users must be able to correct wrong category tags at any time.

## Decisions (resolved)

1. **₪8100 check = שכירות** — default keyword `משיכת שיק` → `שכירות`; existing `אחר` rows reclassified when user runs / on deploy via `reclassifyFallback`.
2. **Header KPIs (UI Designer)** — one formula app-wide: **countable** (exclude `העברות`, `כרטיס אשראי`, `חיסכון והשקעות`). Labels carry the same Hebrew subtext. Do not keep a second silent “all outflows” metric under the same word.
3. **Credit cards** — deferred; keep / strengthen coverage banner; no block on Cal/Isracard.
4. **Retagging** — first-class: change category from cashflow list and from month composition; `applyToSimilar` remains available.

## User stories

- As Alpir, I want one meaning of "הוצאות" everywhere, so that header and insights never disagree.
- As Alpir, I want to see which transactions make up a month total (and which were excluded), so that a rent-sized line cannot look like my only spending without explanation.
- As Alpir, I want check withdrawals for rent categorized as `שכירות`, so that category charts match reality.
- As Alpir, I want to change any transaction’s category when it is wrong, optionally applying to similar rows, so that mistakes are fixable.
- As Alpir, I want month buckets to match Asia/Jerusalem, so that bank midnight timestamps land in the right month.
- As Alpir, I want a clear coverage warning until I connect a credit card, so that I know itemized card spend is missing.

## Acceptance criteria

1. **Given** August-like data (Cal settlement + ₪8100 check), **when** insights and page header render the current month, **then** both expense totals match within ₪0.01 after excluding internals, and subtext reads `ללא העברות וחיובי אשראי`.
2. **Given** the selected month, **when** the user opens `ממה מורכב הסכום`, **then** included and excluded rows are listed with date, description, category, amount; from an included row the user can change category.
3. **Given** `משיכת שיק` (and existing שכירות keywords), **when** categorization runs, **then** category is `שכירות` unless a user rule overrides.
4. **Given** a row already tagged `אחר` that matches a stronger keyword/rule, **when** `categorizeBacklog` runs with `reclassifyFallback: true` (default), **then** that row is updated.
5. **Given** cashflow tab, **when** the user picks a new category on a row, **then** `setTransactionCategory` runs (optional apply-to-similar checkbox or confirm).
6. **Given** no credit-card connection and hidden card share > 0, **when** insights load, **then** the coverage banner remains visible with CTA to accounts (copy acknowledges “אפשר גם מאוחר יותר”).
7. **Given** timestamps like `…T21:00:00.000Z`, **when** `monthKey` runs, **then** the Asia/Jerusalem calendar month is used; Vitest covers a boundary case.
8. **Given** KPI cards, **when** rendered, **then** each has Hebrew subtext defining the metric (no identical bare “הוצאות” without qualification on two different formulas).

## Data model

No schema changes. Categories already include `שכירות` in `packages/types`.

## tRPC API

Router: `packages/api/src/routers/finance.ts`.

| Procedure | Kind | Change |
|-----------|------|--------|
| `getSummary` | query | Countable monthly income/expense; return `monthlyExpensesExcluded`, `monthlyIncomeExcluded`. |
| `analytics.monthlyTrend` / `categoryBreakdown` / `insights` / `recurring` | query | `monthKey` via Asia/Jerusalem. |
| `analytics.monthComposition` | query (new) | `{ month, direction?: 'expense'\|'income' }` → included/excluded rows + totals. |
| `categorizeBacklog` | mutation | Add `reclassifyFallback` (default true): also re-tag `אחר` / null when new category differs. |
| `setTransactionCategory` | mutation | Unchanged (used for retag UX). |

## UI surface

- `page.tsx` — header labels + subtext; countable totals from `getSummary`.
- `InsightsTab.tsx` — KPI subtext; `ממה מורכב הסכום` opens composition; coverage banner soft CTA.
- `components/MonthCompositionPanel.tsx` — included/excluded lists + inline category change.
- Cashflow table in `page.tsx` — category `<select>` per row.
- `lib/format.ts` — `currentMonthKey` Asia/Jerusalem.

## Microcopy (UI Designer)

| Place | Label | Sub |
|-------|-------|-----|
| Header expense | הוצאות החודש | ללא העברות וחיובי אשראי |
| Header income | הכנסות החודש | ללא העברות פנימיות |
| Insights expense | הוצאות | ללא העברות וחיובי אשראי |
| Insights income | הכנסות | ללא העברות פנימיות |
| Composition CTA | ממה מורכב הסכום | — |
| Card banner | (keep %) | אפשר לחבר כרטיס מאוחר יותר — בינתיים הסכום לא כולל פירוט קניות באשראי |

## Out of scope

- Connecting Cal/Isracard credentials for the user.
- IBKR / VAT.
- ML categorizer.

## Open questions

(none)
