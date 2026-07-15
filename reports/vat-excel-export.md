# Review — VAT Excel Export

> **Slug:** `vat-excel-export`
> **Spec:** `docs/specs/vat-excel-export.md`
> **Reviewed:** 2026-07-15
> **Verdict:** APPROVED

## Scope

One-click export of VAT ledger entries (current bimonthly period or full year) to an Excel-compatible CSV matching the legacy "ספר תגבולים" column layout.

## Changes

- `packages/api/src/services/vat-excel-export.ts` — builds UTF-8 BOM CSV with `computeVatBreakdown` columns
- `packages/api/src/routers/vat.ts` — `exportExcel` protected query (`year`, optional `period`)
- `apps/web/src/app/finance/VatTab.tsx` — "📥 ייצא לאקסל" button (period + annual views)
- Tests: `vat-excel-export.test.ts`, extended `vat.test.ts`, e2e button check

## Verification

- Vitest: `vat-excel-export` + `vat` router — **12 passed**
- No schema changes

## Notes

- Format is `.csv` (Excel opens Hebrew correctly via BOM). Full multi-sheet `.xlsx` left out of scope.
