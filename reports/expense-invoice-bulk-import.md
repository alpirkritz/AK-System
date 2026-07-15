# Review — Bulk Invoice Import from Expense Folders

> **Slug:** `expense-invoice-bulk-import`
> **Spec:** `docs/specs/expense-invoice-bulk-import.md`
> **Reviewed:** 2026-07-15
> **Verdict:** APPROVED

## Scope

Adds a bulk-import layer on top of the existing VAT feature: the server reads invoice files directly from the local Google Drive `Expenses/YYYY_MM` folders, OCRs each with Gemini, and presents an editable review queue that commits into the existing `vatEntries` table. Bulk ingestion only (per approved scope) — no file storage, exports, company report, or mobile.

## Changes

- `packages/api/src/services/expense-folders.ts` (new) — `getExpensesDir()` (env `EXPENSES_DIR`, defaulted), `isExpensesDirAvailable()`, `folderToPeriod()`, traversal-safe `resolveSafeFolder()`/`resolveSafeFile()`, `listExpenseFolders()`, `listFolderFiles()`, `readInvoiceFile()`.
- `packages/api/src/routers/vat.ts` — extracted reusable `createEntryInput`; new procedures `createBatch`, `listExpenseFolders`, `listFolderFiles`, `parseFolderFile`. `getImportedPaths()` builds the dedup set from `invoice_file_url`.
- `apps/web/src/app/finance/VatBulkImport.tsx` (new) — folder picker → scan → sequential OCR → editable review queue with confidence badges + live VAT preview → `createBatch` commit.
- `apps/web/src/app/finance/VatTab.tsx` — "📁 ייבוא מתיקייה" trigger + lazy-loaded modal; invalidates list/period/annual summaries on import.
- Tests: `expense-folders.test.ts` (17), `vat.test.ts` (5), `e2e/vat-bulk-import.spec.ts` (1).

## Data Model

No schema changes. Reuses `vat_entries.invoice_file_url` as provenance + dedup key. SQLite/Postgres parity unaffected.

## Verification

- `pnpm test` — 16 files, **127 tests passed** (incl. 22 new).
- `pnpm --filter @ak-system/web build` — **success**; `/finance` compiles.
- `e2e/vat-bulk-import.spec.ts` — **1 passed** (modal opens from the VAT tab and closes).
- Lint: `apps/mobile` + `apps/whatsapp-bridge` `tsc --noEmit` pass. `apps/web` `next lint` is unconfigured/interactive in this environment (pre-existing, not introduced here); type safety validated via the production build.

## Security

- Path traversal blocked: folder must match `^\d{4}_\d{2}$`; file name rejects `/`, `\`, `\0`, `.`/`..`, and non-`pdf/jpg/jpeg/png` extensions; resolved paths verified to stay inside the base dir (covered by tests).
- All new procedures are `protectedProcedure` (auth required).
- Server-side file reads are gated by `isExpensesDirAvailable()`; unavailable base dir returns a friendly Hebrew error instead of throwing raw fs errors.

## Notes / Nits

- OCR runs sequentially per file (safe for Gemini rate limits); for very large folders a small concurrency could speed this up (out of scope).
- Bulk import only works where the server has the Google Drive mount (documented in spec Out of Scope).
- Pre-existing flake: `pnpm run pretest` (drizzle-kit push) can fail against a stale `packages/api/test-data/*.sqlite` ("index already exists"); clearing the stale DB resolves it. Unrelated to this change.
