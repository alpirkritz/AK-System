# Bulk Invoice Import from Expense Folders

> **Slug:** `expense-invoice-bulk-import`
> **Status:** Approved
> **Last Updated:** 2026-07-15
> **Stack:** next-trpc-monorepo (`apps/web`, `packages/api`, `packages/database`)

## Goal

Today the business owner retypes every invoice from `Expenses/YYYY_MM/` into Excel, then derives the VAT/annual numbers by hand. The app already reproduces those calculations (`computeVatBreakdown`) and has a working "דיווח מע"מ" tab — but entries are added one at a time and the original files are never linked. This feature lets the user pick a month, have the server read that Google Drive folder, OCR every invoice at once, auto-fill category/date/amount/VAT, and confirm a batch into `vatEntries` — with already-imported files skipped on re-scan.

## User Stories

- As the business owner, I want to pick a month folder and have all its invoices OCR'd at once so I stop retyping into Excel.
- As the reviewer, I want each auto-parsed row editable (category, date, amount, VAT-exempt, deduction %) with low-confidence rows flagged, so I can correct before committing.
- As a repeat user, I want files I already imported to be skipped/greyed on re-scan so I never double-count.

## Acceptance Criteria

- [ ] A "ייבוא מתיקייה" action in the VAT tab lists available `YYYY_MM` folders with file count + already-imported count.
- [ ] Selecting a folder lists its invoice files (`.pdf/.jpg/.jpeg/.png`); files already in `vatEntries` (matched by stored source path) are marked "יובא".
- [ ] Scanning parses each not-yet-imported file via the existing Gemini OCR and prefills a review row (category, date, amount, invoice #, description, deduction %, exempt), plus a confidence badge.
- [ ] Each review row is editable; period is derived from the row's date (`ceil(month/2)`), defaulting to the folder's period.
- [ ] "ייבא N רשומות" commits selected rows to `vatEntries` in one call, storing the absolute file path in `invoiceFileUrl`; period/annual summaries refresh.
- [ ] Re-scanning the same folder shows the just-imported files as "יובא" and does not re-OCR them by default.
- [ ] Path traversal is impossible: folder must match `^\d{4}_\d{2}$`, file must resolve inside the configured base dir with an allowed extension.
- [ ] If the base dir is unreadable (e.g. running on EC2 without the Drive mount), procedures return a clear error and the UI shows "תיקיית ההוצאות אינה נגישה מהשרת".

## Data Model

**No schema changes.** Reuse `vatEntries` (`packages/database/src/schema.ts` + `packages/database/src/schema.pg.ts` — already in parity, both already declare `invoice_file_url`/`invoiceFileUrl`). The existing `invoice_file_url` column stores the invoice's absolute source path, serving as both provenance and the dedup key.

## tRPC API

New procedures on `vatRouter` (`packages/api/src/routers/vat.ts`), all `protectedProcedure`:

- `listExpenseFolders` — query, input `{ year?: number }`. Reads base dir; returns `{ folder, year, month, period, fileCount, importedCount }[]` (folders matching `YYYY_MM`, `Archive` excluded, newest first). Returns `{ available: false, reason }` shape when the base dir is unreadable.
- `listFolderFiles` — query, input `{ folder: string }` (validated `^\d{4}_\d{2}$`). Returns `{ fileName, sizeBytes, mimeType, alreadyImported }[]`; `alreadyImported` = a `vatEntries.invoiceFileUrl` equals the file's absolute path.
- `parseFolderFile` — mutation, input `{ folder, fileName }`. Validates path (traversal-safe), reads file, base64-encodes, calls `parseInvoiceWithVision`, returns `InvoiceParseResult & { year, period, filePath }`.
- `createBatch` — mutation, input `{ entries: CreateInput[] }` reusing the existing `create` Zod shape (incl. `invoiceFileUrl`). Inserts all rows in a loop; returns `{ inserted }`.

New service `packages/api/src/services/expense-folders.ts`:

- `getExpensesDir()` — reads `EXPENSES_DIR` env var, defaulting to the known Drive path (`.../Alpir Consulting/2 - Finanace/Expenses`).
- `resolveSafeFolder(folder)` / `resolveSafeFile(folder, fileName)` — traversal-safe resolution that guarantees the result stays inside the base dir and has an allowed extension; throws `TRPCError('BAD_REQUEST')` otherwise.
- `folderToPeriod(folder)` — parses `YYYY_MM` into `{ year, month, period }`.

## UI Surface

- New component `apps/web/src/app/finance/VatBulkImport.tsx`, opened as a modal from a new "📁 ייבוא מתיקייה" button in `apps/web/src/app/finance/VatTab.tsx` header (next to "+ הוסף רשומה").
- Flow: pick folder (dropdown with counts) → "סרוק תיקייה" → per-file rows auto-parse sequentially (small concurrency, throttled to respect Gemini limits) with spinner + confidence badge → editable review table → select rows → "ייבא N רשומות".
- Reuses `VAT_CATEGORIES`, `computeVatBreakdown` for the live per-row VAT preview; RTL Hebrew; existing `.card/.btn/.input/.select` classes and the dark theme.

## Out of Scope

- Copying/storing files into the app (reads in place from the Drive mount).
- Exports (bimonthly VAT / annual "ספר תגבולים" CSV/Excel), company reimbursement report, mobile snap-a-receipt.
- Google Drive API integration (uses the local CloudStorage filesystem mount only — bulk import works when the server has that mount, e.g. running locally).
- Changes to the existing single-entry OCR modal.

## Open Questions

- `EXPENSES_DIR` default confirmed as `.../Alpir Consulting/2 - Finanace/Expenses` (folders `2026_06`, `2026_07`, ...).
- OCR throughput: sequential per-file with small concurrency (2–3) to avoid Gemini rate limits — acceptable for ~10–30 files/month.
- Dedup key: match on stored file path (robust). Secondary duplicate warning on same invoiceNumber+amount+date is optional and not included in this iteration.
