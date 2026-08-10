# QA UI report — cashflow-data-reliability

**Stack:** next-trpc-monorepo  
**Verdict:** FAIL (explainability / label collision)

## Automated

- UI shell / Playwright deep pass: not re-run; e2e coverage is smoke (`finance-insights.spec.ts`) and would PASS while KPIs remain misleading.
- Unit analytics: PASS (61/61) — does not validate Hebrew UX clarity.

## Manual / exploratory (code + production numbers)

### Interaction
- Insights KPIs labeled `הכנסות` / `הוצאות` with no inline definition of exclusions.
- Coverage banner for hidden card share exists when `!creditCardConnected && hiddenCardShare > 0` (`InsightsTab.tsx` ~104–114) — good, but easy to miss next to a confident ₪8.1k expense headline.
- No UI to open “which rows make this total?”

### Keyboard / focus
- Not exercised this pass (no modal/composition UI yet). Future composition drawer must trap focus and Escape-close.

### Responsive
- Existing card grid patterns; no new layout in this audit.

### Accessibility (spot)
- KPI meaning is not exposed via `aria-describedby` / tooltip; screen reader hears “הוצאות” without “ללא כרטיס אשראי והעברות”.
- Footer exclusion sentence is low-contrast muted text at bottom — fails “obvious attribution” for the user’s question.

### i18n / copy
| Surface | Label | Actual formula | Risk |
|---------|-------|----------------|------|
| `page.tsx` header | הוצאות החודש | `getSummary` SUM all expenses in local-month window | Looks like “what I spent” |
| `InsightsTab` KPI | הוצאות | `monthlyTrend` after dropping internal categories | Looks identical to header |
| Donut | סך ההוצאות / הרכב ההוצאות | Countable only | Implies full composition |
| Recurring | סך חיובים קבועים בחודש | Sum of detected monthly averages | Not posted total |
| Footer | העברות…לא נכללים | Correct but weak | User still read 8100 as “only expense” |

### Cross-browser
- Not run.

## Failures

1. Identical Hebrew “הוצאות” for two formulas (`page.tsx:275` vs `InsightsTab.tsx:149`).
2. ₪8100 check shown under category charts as `אחר` — no rent signal in UI.
3. No composition drill-down; attribution is a one-line footer only.
4. Card-blind-spot banner is present but insufficient next to rent-sized KPI.

## Evidence

- Production August rows: Cal settlement ₪8884.60 excluded; check ₪8100 included as `אחר` (see `reports/qa-cashflow-data-reliability.md`).
- Spec: `docs/specs/cashflow-data-reliability.md`

## Recommendations (P0)

1. Rename or subtitle KPIs immediately (copy-only) so header ≠ insights.
2. Add month composition panel (included vs excluded).
3. Amplify card-connection CTA when countable expense ≈ standing orders only.
4. Recategorize / rule for `משיכת שיק` rent after user confirmation.
