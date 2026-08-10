# QA report — cashflow-data-reliability

**Detected stack:** next-trpc-monorepo  
**Verdict:** FAIL (data reliability / product correctness — not unit-test breakage)

- Static check: SKIPPED (audit focused on live numbers; no production code changed in this pass)
- Unit tests: 61/61 passed (`cashflow-analytics.test.ts` 37, `finance.analytics.test.ts` 24)
- E2E: SKIPPED (existing `finance-insights.spec.ts` is smoke-only; would not catch this class of bug)
- Production DB audit (EC2 `/data/ak_system.sqlite`): FAIL vs user expectations — see Findings
- Total time: ~2 min unit + ~1 min prod sample

## Per-phase results

### 1. Static
Not run. No source edits in this QA pass.

### 2. Unit/integration tests

```
✓ src/services/cashflow-analytics.test.ts (37 tests)
✓ src/routers/finance.analytics.test.ts (24 tests)
```

Tests encode the *current* contract (exclude internals, UTC `slice(0,7)` month keys). They pass — and that is why the UI can look “correct” while still misleading Alpir.

### 3. Production audit (EC2, 2026-08-04)

Connected accounts: Hapoalim + Otsar HaHayal only (`account_type=bank`). No credit-card connection.

**August 2026 expense rows (all `bank_scrape`):**

| Amount | Category | Description | In insights KPI? |
|--------|----------|-------------|------------------|
| 8884.60 | כרטיס אשראי | עפ"י הרשאה כאל | No (internal) |
| 8100.00 | אחר | 1192086 משיכת שיק | Yes |
| 86.36 | אחר | כרטיסי אשראי ל | Yes |

- Countable insights expense ≈ **₪8,186** (8100 + 86.36)
- All bank outflows ≈ **₪17,071**
- The ₪8100 line is **not** categorized as דיור/שכירות — it is a check withdrawal in `אחר`

**July 2026 (for contrast):** countable expenses ≈ ₪11,543 (`אחר` + `ביטוח`); excluded internals ≈ ₪16,131 (card + transfers).

## Failures

1. **Missing spend itemization** — Card settlement excluded without Cal/Isracard connection → household spend invisible. Matches design intent of `cashflow-insights.md` but fails user mental model (“cannot be only rent”).
2. **Mis-categorization** — Likely-rent ₪8100 check → `אחר`, not `דיור` (`RENTISH` query empty).
3. **Dual KPI definitions** — Page `הוצאות החודש` (`getSummary`, includes internals) vs Insights `הוצאות` (excludes internals). Same Hebrew word, different math.
4. **Month key policy** — `monthKey = iso.slice(0,7)` (UTC). Sample timestamps `…T21:00:00.000Z` are Israel-midnight style; risk of wrong month at month boundaries. No Vitest coverage for Asia/Jerusalem.
5. **Explainability** — Footer note exists (“העברות פנימיות וחיובי אשראי לא נכללים”) but no drill-down of included/excluded rows; KPI cards have no definition subtext.
6. **E2E gap** — Playwright does not assert month totals or exclusion.

## Notes

- Spec for fix: `docs/specs/cashflow-data-reliability.md`
- Unit suite green does **not** mean numbers are trustworthy for Alpir’s questions.
- Recommended next step after PM approval: implement AC 1–3 + 6 (copy + exclusion alignment + composition) before timezone normalization.
