# QA report — sales-documents

**Detected stack:** next-trpc-monorepo
**Spec:** `docs/specs/sales-documents.md`
**Date:** 2026-08-05
**Verdict:** PASS (all sales-documents tests green; 10 pre-existing e2e failures in untouched areas)

| Phase | Command | Result |
|---|---|---|
| Schema push | `pnpm run pretest` | PASS (idempotent — second run reports "No changes detected") |
| Unit / integration | `pnpm test` | PASS — 40 files, 463 tests |
| E2E (new specs) | `playwright test e2e/sales-documents.spec.ts e2e/sales-pricing-memory.spec.ts` | PASS — 10/10 |
| E2E (full suite) | `pnpm e2e` | 46 passed, 1 skipped, 10 failed — all failures pre-existing, see below |
| Lint | `pnpm -r run lint` | mobile + whatsapp-bridge `tsc --noEmit` PASS; `apps/web` `next lint` unconfigured (pre-existing) |
| Build | `pnpm --filter @ak-system/web build` | PASS — includes `/finance/documents/[id]/print`, `/settings/business`, `/settings/companies`, `/settings/pricing` |

## New tests added

**Vitest (packages/api) — 60 tests**

| File | Tests | Covers |
|---|---|---|
| `src/lib/sales-types.test.ts` | 18 | line/document totals, VAT modes, non-vatable lines, document-type rules, allowed conversions, allocation-number thresholds, bilingual string parity, print file names |
| `src/services/pricing-memory.test.ts` | 6 | price precedence (pinned → history → catalog), currency-mismatch flag, latest-per-item collapsing, free-text lines ignored |
| `src/routers/companies.test.ts` | 7 | create defaults (`IL`/`he`/`company`), search by name and tax ID, foreign client, partial update, contact linking and detaching, delete |
| `src/routers/service-items.test.ts` | 9 | catalog CRUD + archive, catalog fallback, history from issued documents only, per-client isolation, pinned override, idempotent pin/unpin, currency mismatch |
| `src/routers/sales-documents.test.ts` | 26 | client snapshot, language default, totals + discounts, exchange-rate enforcement, `totalIls`, sequential numbering per type, start numbers from settings, frozen issuer snapshot, issue lock, receipt-needs-payment, VAT ledger sync (period, amount, exemption, back-link, quotes skipped), credit notes, cancel rules, conversions, duplicate, payments, filters, yearly summary, draft deletion |

**Playwright (apps/web/e2e) — 10 tests**

- `sales-documents.spec.ts` — quote draft with inline client creation, issuing a tax invoice (numbered, locked, no edit/delete), recording a payment, foreign-currency rate gate, printable document in a separate tab, empty state CTA.
- `sales-pricing-memory.spec.ts` — catalog item creation, catalog default for a new client, memory of the price actually charged after issuing, and a second client staying on the catalog default.

## Acceptance criteria coverage

Every criterion in the spec's *מספור ונעילה*, *חוקי סוגי מסמכים*, *חישובים, מע״מ ומטבע*, *זיכרון תמחור* and *דו-לשוניות* sections has at least one automated test. From the *UI ו-UX* section, the automated e2e covers price-source hints, no re-fill after manual edit, the exchange-rate block, the issue confirmation dialog and the empty state. Three criteria are verified by code review only, because they are hard to assert reliably in Playwright:

- foreign-client suggestion banner (`country !== 'IL'` → English + zero-rated) — rendered by `DocumentFormModal`, dismissible;
- allocation-number banner threshold behaviour — unit-tested through `requiresAllocationNumber`, not through the DOM;
- `@media print` page geometry — cannot be asserted without a PDF snapshot.

## Pre-existing e2e failures (not caused by this feature)

All ten failures are in specs and pages this feature does not touch. Root causes visible in the assertions:

| Spec | Cause |
|---|---|
| `full-flow.spec.ts` (2) | Dashboard greeting is time-of-day dependent (`שלום` vs `ערב טוב`); `/recurring` no longer renders a `פגישות חוזרות` heading |
| `qa-structured.spec.ts` (4) | Same dashboard/navigation assertions as above |
| `trading-journal.spec.ts` | Strict-mode violation: `P&L ממומש` matches two elements |
| `bank-accounts.spec.ts` | Strict-mode violation: `חיובי אשראי` matches two elements |
| `agents-triggers.spec.ts` | WhatsApp bridge `ECONNREFUSED` — bridge service not running locally |
| `task-workspaces.spec.ts` | Passes in isolation; fails only in the full run (shared-DB ordering) |

`TradingJournalTab.tsx` and the dashboard page are not modified in the working tree at all, so those assertions fail against committed code.

## Fix applied during QA

`pnpm run pretest` (and therefore `pnpm test`) broke once the new tables existed in the SQLite test DB: `drizzle-kit push` treated the bootstrap-only `google_connections` table as an orphan and asked, interactively, whether each new table was a rename of it. Added `tablesFilter: ['!google_connections']` to `packages/database/drizzle.config.ts` so push ignores the raw-SQL-only table. `pnpm run pretest` is now non-interactive and idempotent.

Note for future schema work: every table created by the `getDb()` bootstrap drifts slightly from its Drizzle definition (`id TEXT PRIMARY KEY` vs `text PRIMARY KEY NOT NULL`, `DEFAULT 1` vs `DEFAULT true`), so `drizzle-kit push` against a bootstrap-created database tries to recreate those tables and fails on duplicate index statements. This predates this feature; the workaround is to let push create the schema on a fresh file, which is what the test and e2e flows do.
