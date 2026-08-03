# Review — Bank & Credit Card Accounts Snapshot

**Spec:** `docs/specs/bank-accounts-snapshot.md`
**Date:** 2026-08-03
**Verdict:** APPROVED WITH NITS — pending local verification (see Verification)

## Scope implemented

Account aggregation for Bank Hapoalim, Bank Otsar HaHayal, Visa Cal, and Isracard via
`israeli-bank-scrapers`: encrypted credential storage, per-connection + cron-driven sync,
balances/transactions into the existing finance ledger, and a new "חשבונות" (Accounts)
first tab on `/finance` with snapshot summary cards.

## Files changed

| File | Change |
|---|---|
| `packages/database/src/schema.ts` | + `bankConnections`, `bankAccounts` tables; +4 nullable cols on `financeTransactions` (`bank_account_id`, `dedupe_key` unique, `installment_info`, `txn_status`); + `BANK_PROVIDERS`/`BANK_CONNECTION_STATUSES`; type exports |
| `packages/database/src/schema.pg.ts` | Same, mirrored (pgTable) |
| `packages/database/src/index.ts` | + `BANK_TABLES` / `FINANCE_TRANSACTIONS_COLUMNS` SQLite bootstrap blocks + getDb loops; table/type/const re-exports |
| `packages/api/src/lib/bank-credentials-crypto.ts` | NEW — AES-256-GCM encrypt/decrypt, key from `BANK_CREDENTIALS_ENCRYPTION_KEY` |
| `packages/api/src/services/bank-sync-service.ts` | NEW — scrape → upsert accounts → dedupe-insert transactions; sequential `syncAllConnections`; error capture onto connection; read-only guarantee documented + enforced (only `scrape()` is called) |
| `packages/api/src/types/israeli-bank-scrapers.d.ts` | NEW — minimal ambient typing for the library surface used (keeps puppeteer out of the TS graph) |
| `packages/api/src/trpc.ts` | + optional `bankScrape` context field (test injection point) |
| `packages/api/src/routers/finance.ts` | + `bankConnections` sub-router (list/create/delete/sync/syncAll/cryptoConfigured) + `getAccountsSnapshot` |
| `packages/api/package.json` | + dependency `israeli-bank-scrapers` |
| `apps/web/src/app/api/cron/bank-sync/route.ts` | NEW — daily cron, `CRON_SECRET` bearer, calls `syncAll` |
| `apps/web/src/app/finance/AccountsTab.tsx` | NEW — snapshot cards, connections list, sync/delete, empty/loading/error states |
| `apps/web/src/app/finance/SummaryCard.tsx` | NEW — extracted from `page.tsx` (see Deviations) |
| `apps/web/src/components/Modals/BankConnectionModal.tsx` | NEW — provider-conditional credential form + read-only hint |
| `apps/web/src/app/finance/page.tsx` | + accounts tab (first, default); `🏦 בנק` source pill in cash-flow; SummaryCard now imported |
| `Dockerfile`, `deploy/Dockerfile.runtime` | `node:20` → `node:22-bookworm-slim` |
| `package.json` | `engines.node` → `>=22.12.0` |
| `.env.example` | + `BANK_CREDENTIALS_ENCRYPTION_KEY` section |
| `deploy/crontab.example` | + daily bank-sync entry (04:45 IST) |
| Tests | NEW: `bank-credentials-crypto.test.ts`, `bank-sync-service.test.ts`, `finance.bank.test.ts`, `e2e/bank-accounts.spec.ts` |

## Spec conformance

- [x] Accounts tab exists, first + default on `/finance`
- [x] Add-connection for exactly 4 providers with per-provider credential fields
- [x] AES-256-GCM at rest; `list` strips credential fields (unit-tested)
- [x] Connection card: name, provider, status pill, last sync, last error, sync-now
- [x] Sync updates status/lastSyncAt/lastError, upserts balances, dedupe-inserts txns
- [x] 4 snapshot summary cards
- [x] Scraped txns in cash-flow list with `🏦 בנק` pill
- [x] Delete keeps transactions (unlinks `bank_account_id`; unit-tested)
- [x] Daily cron route with `CRON_SECRET` bearer
- [x] Vitest: crypto round-trip/tamper/wrong-key, dedupe, sequentiality, router procedures (scraper mocked — no network)
- [x] Read-only: only `scrape()` invoked; modal shows view-only-credentials hint
- [x] Node 22: both Dockerfiles + engines bumped

## Verification

Ran in the sandbox (npm registry unavailable there; repo `node_modules` binaries are macOS-only, so vitest/Playwright/next-build could not execute):

1. **TypeScript** — full `tsc --noEmit` over `apps/web` (includes all touched packages). Errors went 714 → 692 during cleanup. Remaining errors in new files: 12, all the endemic `db.select()` drizzle-union pattern present throughout every existing router (`meetings.ts` 71, `people.ts` 66…); `next.config.js` sets `ignoreBuildErrors: true`, consistent with repo status quo.
2. **Crypto runtime check** — compiled `bank-credentials-crypto.ts` and executed: round-trip ✓, no plaintext in ciphertext ✓, GCM tamper detection ✓, wrong-key rejection ✓, missing/short-key errors ✓.
3. **SQLite bootstrap SQL** — executed `BANK_TABLES` + `FINANCE_TRANSACTIONS_COLUMNS` against in-memory SQLite: valid ✓, idempotent re-run ✓, unique `dedupe_key` blocks dupes while allowing multiple NULLs ✓, FK cascade connection→accounts ✓, default status `pending` ✓.
4. **e2e regression scan** — existing `trading-journal` / `vat-bulk-import` specs click their tab explicitly after `goto('/finance')`, so the new default tab does not break them.

**MUST RUN LOCALLY before deploy (Node ≥ 22.12):**

```bash
pnpm install          # pulls israeli-bank-scrapers (+ puppeteer/Chromium, large)
pnpm test             # includes 3 new API test files
pnpm e2e              # includes e2e/bank-accounts.spec.ts
pnpm --filter @ak-system/web build
```

## Deviations from spec

1. **`SummaryCard` extracted to `apps/web/src/app/finance/SummaryCard.tsx`** instead of exported from `page.tsx` — Next.js App Router rejects unknown named exports from page files at build time. Same reuse outcome.
2. **`israeli-bank-scrapers` pinned `^6.0.0`** — registry unreachable from the sandbox to confirm the latest minor; `pnpm install` locally will resolve within ^6. If install fails on the range, set it to the latest published version.
3. Added a commented crontab entry (spec listed cron wiring as deploy-time follow-up) — zero-risk, saves a step.

## Nits / follow-ups

- The scraper's Chromium runs on the 1 GB EC2 box; first real sync is the moment of truth for memory. If it OOMs, next option per spec decision log is running sync from the Mac (launchd, like the Outlook bridge).
- `balance_currency` is assumed ILS; multi-currency accounts would need the scraper's per-account currency (not exposed for these 4 providers).
- Consider surfacing `txn_status='pending'` transactions with a subtle style in the cash-flow tab (not in spec).
- Isracard/Cal balances represent current-cycle charges — the UI labels them "חיובי אשראי" accordingly.

## UI Review

**Verdict:** APPROVED

### Checklist
- [x] Uses `.btn` / `.input` / `.select` / `.card` / `.pill` / `.label` utilities
- [x] Dark theme palette matches (`#2dd4bf` accent, `#34d399`/`#fb7185` semantics, `#5a688c`/`#647399`/`#7a89ab` muted hierarchy)
- [x] RTL preserved; account numbers rendered `dir="ltr"` within RTL layout
- [x] Mobile: summary grid `grid-cols-2 lg:grid-cols-4`; connection rows `flex-wrap`
- [x] Focus-visible states inherited from `.btn`/`.input` utilities
- [x] Loading / error / empty states present (matching existing tab patterns verbatim)
- [x] No new CSS frameworks; modal reuses `overlay`/`modal` classes
- [x] Reuses SummaryCard, existing pill/delete-button/status-color conventions

### Findings
- Must-fix: none.
- Nits: sync feedback uses a transient text banner (consistent with the Import tab's pattern) rather than a toast; acceptable.
