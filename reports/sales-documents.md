# Review — sales-documents

**Detected stack:** next-trpc-monorepo
**Spec:** `docs/specs/sales-documents.md`
**QA report:** `reports/qa-sales-documents.md`
**Date:** 2026-08-05
**Verdict:** APPROVED WITH NITS

An in-house sales-document module for `/finance`: six Israeli document types, sequential per-type numbering, a client-company registry, a service catalog with per-client price memory, bilingual (he/en) printable documents, foreign currency with a mandatory exchange rate, and automatic income entries in the existing VAT ledger.

## Checks

| Check | Result |
|---|---|
| `pnpm test` | PASS — 463 tests, including 60 new ones for this feature |
| `pnpm --filter @ak-system/web build` | PASS — all four new routes compiled |
| `pnpm -r run lint` | mobile + whatsapp-bridge `tsc --noEmit` PASS; `apps/web` `next lint` is unconfigured in this repo (pre-existing) |
| E2E for this feature | PASS — 10/10 |
| Full E2E | 10 pre-existing failures in untouched specs (see QA report) |

## Spec conformance

Data model, tRPC surface and UI surface match the spec. Schema changes landed in all three required places — `schema.pg.ts`, `schema.ts` and the idempotent bootstrap in `database/src/index.ts` — with money as `text`, dates as ISO `text`, and booleans as `integer` on SQLite.

Behavioural rules implemented as specified: drafts carry no number and are the only editable/deletable state; issuing allocates a continuous per-type number seeded from `startNumbers`; credit invoices require an issued source; receipts and tax-invoice-receipts require a payment; only quotes and proformas can be cancelled; conversions are restricted to `allowedConversions`; foreign currency without a rate is rejected before anything is written.

Two intentional supersets of the spec's API table, both justified by acceptance criteria: `salesDocuments.get` also returns `issuer` (drafts render the live profile, issued documents their frozen snapshot), and `setInternalNotes` exists so an internal note stays editable after issue.

## Findings

### Nits

1. **`list` reads the whole payments table** — `packages/api/src/routers/sales-documents.ts:224` selects every row in `sales_document_payments` to build the paid-per-document map, rather than joining or filtering to the documents in the page. At 1–5 documents a month this is free; revisit only if the table ever grows.

2. **`people.update` now nulls `companyId` when the field is omitted** — `packages/api/src/routers/people.ts:404`. This follows the existing pattern in that mutation (`company`, `jobTitle`, `tags` behave identically), but any caller that sends a partial person payload — the mobile app, for instance — will silently unlink the billing company. Worth keeping in mind if partial updates are ever introduced there.

3. **No "view" row action** — the spec lists הצג alongside הדפס in `DocumentsTab`. In practice the print page is the read-only view and drafts open in the editor, so nothing is unreachable; the spec text is slightly ahead of the UI.

4. **Allocation number is advisory, not enforced** — `requiresAllocationNumber` drives the warning banner in the form, but `issue` will happily produce a document above the threshold without one. That matches the spec (the number comes from a manual lookup at the tax authority) and the banner is prominent, so this is a deliberate product choice rather than a gap.

### Deliberate, documented behaviour worth restating

- **Credit invoices do not reach the VAT ledger** — `packages/api/src/routers/sales-documents.ts:548`. `vat.create` rejects negative amounts, so a credit has to be recorded by hand in the VAT tab. This is listed under Out of Scope, and the UI confirmation for creating a credit says so explicitly. The comment at the call site explains why, which is the right place for it.
- **VAT entries are written with the Hebrew category label** (`'הכנסות'`, `packages/api/src/routers/sales-documents.ts:559`) and `taxCode: '1'`, matching how `vat.create` stores rows so the VAT tab renders them identically to manual entries.
- **The issuer snapshot is frozen at issue time**, so later edits to the business profile never rewrite documents already sent — covered by a test.

## Infrastructure change

`packages/database/drizzle.config.ts:13` gained `tablesFilter: ['!google_connections']`. Adding seven tables to the Drizzle schema made `drizzle-kit push` treat the bootstrap-only `google_connections` table as an orphan and prompt, interactively, whether each new table was a rename of it — which hung `pnpm test`. The filter scopes push to tables the schema actually owns. `pnpm run pretest` is now non-interactive and reports "No changes detected" on a second run.

## Security and data integrity

- All procedures are `protectedProcedure`; no new public surface.
- All inputs are Zod-validated; no string interpolation into SQL — every query goes through Drizzle builders.
- Money is computed server-side in `computeAndPersistTotals`; the client's totals are display-only, so a tampered client cannot change what is stored or reported to VAT.
- `uq_sales_documents_type_number` enforces per-type number uniqueness at the database level, not only in application code.
- The print route is a normal authenticated app route; it only bypasses `DashboardLayout`, not auth.
