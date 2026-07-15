# VAT Excel Export

> **Slug:** `vat-excel-export`
> **Status:** Approved
> **Last Updated:** 2026-07-15

## Goal

After importing and reviewing VAT entries in the app, the business owner still needs a spreadsheet for accountants / tax filing that matches the familiar "ספר תגבולים" column layout. This feature adds a one-click export of the currently selected year/period (or full year) to an Excel-compatible CSV (UTF-8 BOM) with the same computed columns as the legacy workbook.

## User Stories

- As the business owner, I want to export the current bimonthly period to Excel so I can send it to my accountant.
- As the business owner, I want annual export to include all entries for the year with the computed VAT columns so I can replace the manual summary sheet.

## Acceptance Criteria

- [ ] VAT tab shows "ייצא לאקסל" for the active period view and for annual summary view.
- [ ] Export downloads a `.csv` file (Excel-openable, UTF-8 BOM) named like `ספר-תגבולים-2026-מאי-יוני.csv` or `ספר-תגבולים-2026-שנתי.csv`.
- [ ] Columns match the legacy sheet: סידורי, קטגוריה, תאריך, חשבונית, פרטים, הכנסה כולל מעמ, תגבולים ללא המעמ, הכנסה פטורת מעמ, מעמ מהכנסות, אחוז, הוצאה כוללת מעמ, הוצאה כולל מעמ מחושב, ההוצאות ללא המעמ, הוצאה פטורת מהמעמ, מעמ מהוצאות, סהכ הוצאות ללא מעמ.
- [ ] Numeric cells use `computeVatBreakdown` (same rules as the UI).
- [ ] Empty period downloads headers only (still a valid file).
- [ ] Auth required (`protectedProcedure`).

## Data Model

No schema changes.

## tRPC API

On `vatRouter` (`packages/api/src/routers/vat.ts`), `protectedProcedure`:

- `exportExcel` — query, input `{ year: number, period?: number (1–6) }`. If `period` omitted → all entries for the year. Returns `{ fileName: string, csv: string }` (CSV text with BOM).

Helper: `packages/api/src/services/vat-excel-export.ts` — `buildVatExcelExport(entries)` → `{ fileName, csv }`.

## UI Surface

- `apps/web/src/app/finance/VatTab.tsx` — button "📥 ייצא לאקסל" next to the period actions (visible in period view and annual view).
- On click: call `vat.exportExcel` with current year (+ period unless annual), then trigger browser download of the returned CSV blob.

## Out of Scope

- Full multi-sheet `.xlsx` workbook (categories sheet + summary formulas).
- Company reimbursement report format.
- Email/send to accountant.

## Open Questions

None — CSV with legacy column headers is sufficient for Excel.
