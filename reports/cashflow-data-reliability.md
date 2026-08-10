# Review — cashflow-data-reliability

## UI/UX Review

**Verdict:** APPROVED  
**Detected stack:** next-trpc-monorepo

### Design System Checklist
- [x] Matches project tokens/classes (`.btn`, `.card`, `.input`, dark theme)
- [x] RTL layout preserved
- [x] Mobile layout works (composition as panel/drawer; 44px targets on month nav already)
- [x] No unapproved UI frameworks
- [x] Reuses `SummaryCard`, `CategorizeDrawer` patterns, cashflow table

### UX Quality Checklist
- [x] One formula for “הוצאות” / “הכנסות” (Clarity + Consistency)
- [x] Cognitive load: subtext on KPIs; drill-down optional
- [x] Feedback: category change immediate; note on success
- [x] Microcopy locked in spec (Hebrew verb-first CTAs)
- [x] Retag from list + composition (user control)

### Findings
- Must-fix (product): dual KPI formulas — **resolved** by unifying on countable + shared subtext.
- Nit: composition panel should Escape-close like other drawers.

### Decision record (question 2)
User deferred to UI Designer. Choice: **unify on countable totals** with explicit subtext `ללא העברות וחיובי אשראי`, not a renamed “all outflows” header. Principle: one term → one meaning (Nielsen Consistency; Apple Clarity).

---

## Implementation status

**IMPLEMENTED + deployed to EC2 (2026-08-04).**

- Countable KPIs + Hebrew subtext on header and insights
- `monthComposition` + retag from panel and cashflow table
- `משיכת שיק` → `שכירות`; prod rows reclassified
- Asia/Jerusalem `monthKey`
- Unit tests: 81/81 (analytics + categorizer + router analytics)
