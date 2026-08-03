# Bank & Credit Card Accounts Snapshot

> **Slug:** `bank-accounts-snapshot`
> **Status:** Approved
> **Last Updated:** 2026-08-03

## Goal

Alpir wants a single view inside the existing Finance area that shows a live snapshot of his bank accounts and credit cards — balances, and recent transactions — pulled automatically instead of manually exporting/uploading CSVs. This adds account-aggregation for four Israeli providers: **Bank Hapoalim**, **Bank Otsar HaHayal**, **Visa Cal**, and **Isracard**, using the open-source `israeli-bank-scrapers` npm library (browser-automation scraping of each provider's existing web portal — there is no regulated open-banking API for these providers in Israel today, so this is the closest practical equivalent). Connected accounts feed into a new "Accounts" tab and into the existing `finance_transactions` table so cash-flow/category views already on the Finance page pick them up alongside manual and CSV-imported entries.

## User Stories

- As Alpir, I want to securely store login credentials for my bank/credit-card accounts so the app can pull data on my behalf without me re-entering credentials each time.
- As Alpir, I want to see, at a glance, my current balance per bank account and per credit card, plus a combined total, so I understand my financial snapshot without opening four separate apps.
- As Alpir, I want newly scraped transactions to land in the same cash-flow view as my manual and CSV-imported transactions, so I have one unified ledger.
- As Alpir, I want to manually trigger a sync ("sync now") per connection, and see the last sync time and any error (e.g. wrong password, account locked), so I can trust the data is current or know why it isn't.
- As Alpir, I want to add or remove a bank/card connection from the UI without redeploying the app.

## Acceptance Criteria

- [ ] A new "חשבונות" (Accounts) tab exists on `/finance`, positioned as the first tab.
- [ ] From that tab, Alpir can add a connection for one of exactly 4 providers (Hapoalim, Otsar HaHayal, Visa Cal, Isracard), entering only the credential fields that provider requires.
- [ ] Credentials are encrypted at rest (AES-256-GCM) in the database; no procedure or UI ever returns/display raw credentials after creation.
- [ ] Each connection shows: display name, provider, status (connected / error / pending / disabled), last sync time, last error message (if any), and a "sync now" button.
- [ ] Triggering "sync now" runs the scraper for that one connection, updates the connection's status/lastSyncAt/lastError, upserts its account balance(s), and inserts new transactions (existing ones from a prior sync are not duplicated).
- [ ] Summary cards at the top of the Accounts tab show: total bank balance (ILS), total credit card balance (current billing-cycle charges), number of connected accounts, and most recent sync time across all connections.
- [ ] Scraped transactions appear in the existing "תזרים" (Cash Flow) tab's transaction list, tagged with a source that visually distinguishes them from manual/CSV entries (mirroring the existing "✏️ ידני" / "📄 CSV" pill pattern, e.g. "🏦 בנק").
- [ ] Deleting a connection removes it and its accounts; past transactions it produced remain in the ledger (not deleted) with their bank-account link cleared.
- [ ] A daily cron endpoint can sync all enabled connections unattended, protected the same way as other `/api/cron/*` routes (`CRON_SECRET` bearer).
- [ ] Vitest coverage for: credential encryption/decryption round-trip, transaction dedupe logic, and the new tRPC procedures (mocking the scraper — no real network calls to bank sites in tests).
- [ ] The integration is strictly **read-only**: the sync service only calls the library's `scrape()` (which reads balances/transactions) and never any action that mutates state on the bank/card site. Where a provider offers a dedicated view-only/inquiry-only credential set (e.g. an "inquiry user" on the bank side), the UI's add-connection modal displays a hint recommending Alpir create and use such credentials rather than his full-access login.
- [ ] Node.js runtime upgraded to 22 (≥22.12): `Dockerfile` + `deploy/Dockerfile.runtime` bumped from `node:20-bookworm-slim` to `node:22-bookworm-slim`, root `package.json` `engines.node` set to `>=22.12.0`, `pnpm install` + full `pnpm qa` re-verified on Node 22 locally before deploy.

## Data Model

All changes below must be mirrored in **both** `packages/database/src/schema.ts` (SQLite) and `packages/database/src/schema.pg.ts` (Postgres), following this codebase's existing convention of `text()` columns for ids/dates/money (no native numeric/timestamp types), matching the style of `financeTrades`/`financeTransactions`. For SQLite, also add the corresponding `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` bootstrap block in `packages/database/src/index.ts`.

### New table: `bank_connections` (export `bankConnections`)

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | uuid |
| `provider` | text, not null | one of `'hapoalim'` \| `'otsarHahayal'` \| `'visaCal'` \| `'isracard'` (matches `israeli-bank-scrapers`' `CompanyTypes`) |
| `display_name` | text, not null | user-chosen label, e.g. "הפועלים עו״ש" |
| `credentials_encrypted` | text, not null | base64 AES-256-GCM ciphertext of the JSON credential object |
| `credentials_iv` | text, not null | base64 initialization vector |
| `status` | text, not null, default `'pending'` | `'pending'` \| `'connected'` \| `'error'` \| `'disabled'` |
| `last_sync_at` | text, nullable | ISO datetime |
| `last_error` | text, nullable | human-readable message |
| `last_error_type` | text, nullable | mirrors scraper `errorType`: `INVALID_PASSWORD` \| `CHANGE_PASSWORD` \| `ACCOUNT_BLOCKED` \| `UNKNOWN_ERROR` \| `TIMEOUT` \| `GENERIC` |
| `created_at` | text, not null | |
| `updated_at` | text, not null | |

Index: `idx_bank_connections_provider` on `provider`.

### New table: `bank_accounts` (export `bankAccounts`)

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | uuid |
| `connection_id` | text, not null | FK → `bank_connections.id` |
| `account_number` | text, not null | as returned by the scraper (full value stored; UI masks all but last 4 chars) |
| `account_type` | text, not null | `'bank'` \| `'credit_card'` (derived from provider: hapoalim/otsarHahayal → bank, visaCal/isracard → credit_card) |
| `balance` | text, nullable | current balance as string (money-as-text convention) |
| `balance_currency` | text, not null, default `'ILS'` | |
| `balance_updated_at` | text, nullable | ISO datetime of last successful balance read |
| `created_at` | text, not null | |

Index: `idx_bank_accounts_connection_id` on `connection_id`.

### Extend existing table: `finance_transactions`

Add columns (all nullable, so existing rows are unaffected):

| Column | Type | Notes |
|---|---|---|
| `bank_account_id` | text, nullable | FK → `bank_accounts.id` |
| `dedupe_key` | text, nullable | sha256 of `${accountNumber}\|${date}\|${chargedAmount}\|${description}`; used to skip re-inserting the same scraped txn on repeat syncs |
| `installment_info` | text, nullable | JSON string `{ number, total }` when the scraper reports an installment purchase |
| `txn_status` | text, nullable | `'completed'` \| `'pending'` (from scraper's `status` field) |

Document (comment in schema, not enforced by a CHECK constraint — matches existing style) that `source` now also accepts `'bank_scrape'` in addition to `'csv_import'` \| `'manual'`.

Indexes: `idx_finance_transactions_bank_account_id` on `bank_account_id`; `idx_finance_transactions_dedupe_key` (unique) on `dedupe_key`.

### Type exports

`packages/database/src/index.ts`: export `BankConnection`/`NewBankConnection`, `BankAccount`/`NewBankAccount` inferred types, alongside the existing `FinanceTrade`/`FinanceTransaction` exports.

## tRPC API

Extend `packages/api/src/routers/finance.ts`'s `financeRouter` with a nested `bankConnections` sub-router, following the same nested-router pattern already used in `packages/api/src/routers/whatsapp.ts` (`whatsapp.connection.*`, `whatsapp.groups.*`).

```ts
finance.bankConnections.list
  protectedProcedure.query
  → BankConnectionWithAccounts[] // connection fields minus credentials_encrypted/credentials_iv, joined with its bank_accounts rows

finance.bankConnections.create
  protectedProcedure
  .input(
    z.discriminatedUnion('provider', [
      z.object({ provider: z.literal('hapoalim'), displayName: z.string().min(1), userCode: z.string().min(1), password: z.string().min(1) }),
      z.object({ provider: z.literal('otsarHahayal'), displayName: z.string().min(1), username: z.string().min(1), password: z.string().min(1) }),
      z.object({ provider: z.literal('visaCal'), displayName: z.string().min(1), username: z.string().min(1), password: z.string().min(1) }),
      z.object({ provider: z.literal('isracard'), displayName: z.string().min(1), id: z.string().min(1), card6Digits: z.string().length(6), password: z.string().min(1) }),
    ])
  )
  .mutation
  → { id: string } // encrypts credentials via new lib, inserts bank_connections row with status 'pending'

finance.bankConnections.delete
  protectedProcedure.input(idInput).mutation
  → { success: true } // deletes the connection + its bank_accounts rows; sets finance_transactions.bank_account_id to null for affected rows (transactions themselves are kept)

finance.bankConnections.sync
  protectedProcedure.input(idInput).mutation
  → { success: boolean; accountsSynced: number; transactionsInserted: number; error?: string }
  // runs bank-sync-service for exactly this connection; updates status/last_sync_at/last_error/last_error_type

finance.bankConnections.syncAll
  protectedProcedure.mutation
  → { results: Array<{ connectionId: string; success: boolean; transactionsInserted: number; error?: string }> }
  // loops all connections with status !== 'disabled'; used by the cron route

finance.getAccountsSnapshot
  protectedProcedure.query
  → {
      totalBankBalance: number
      totalCreditCardBalance: number
      currency: 'ILS'
      connectedCount: number
      lastSyncAt: string | null
      accounts: Array<{ id: string; connectionId: string; displayName: string; provider: string; accountType: 'bank' | 'credit_card'; accountNumber: string; balance: number | null; balanceUpdatedAt: string | null; status: string }>
    }
```

`idInput` reuses the existing `z.object({ id: z.string() })` pattern already defined near the top of `finance.ts` (used by `deleteTrade`/`deleteTransaction`).

Auth: all `protectedProcedure`, same as every other procedure in this router (single-user session gating via NextAuth or mobile bearer token — no new auth model needed).

## Services & Library Integration

- **New dependency:** `israeli-bank-scrapers` (add to `packages/api/package.json` dependencies). Uses `puppeteer` under the hood (downloads a local Chromium at install time — see Open Questions #2 for the size/runtime cost).
- **New file `packages/api/src/lib/bank-credentials-crypto.ts`:** `encryptCredentials(obj): { encrypted, iv }` / `decryptCredentials(encrypted, iv): obj`, AES-256-GCM, key read from `process.env.BANK_CREDENTIALS_ENCRYPTION_KEY` (32-byte base64, generated via `openssl rand -base64 32`; document in `.env.example` next to the existing `VAPID_*`/`CRON_SECRET` secrets).
- **New file `packages/api/src/services/bank-sync-service.ts`:**
  - Maps `provider` → `CompanyTypes` enum value from `israeli-bank-scrapers` (`hapoalim`, `otsarHahayal`, `visaCal`, `isracard` — names match 1:1, confirmed against the library's README).
  - Decrypts the connection's credentials, calls `createScraper({ companyId, startDate }).scrape(credentials)`.
  - On `success: true`: for each `account` in `scrapeResult.accounts`, upserts a `bank_accounts` row (by `connection_id` + `account_number`) with `balance`/`balance_updated_at`; for each `txn`, computes `dedupeKey = sha256(accountNumber|date|chargedAmount|description)` and inserts into `finance_transactions` only if that `dedupe_key` doesn't already exist (`source: 'bank_scrape'`, `direction` derived from sign of `chargedAmount`, `category: null` — left for the user to categorize, same as CSV imports today).
  - On `success: false`: updates the connection's `status: 'error'`, `last_error: scrapeResult.errorMessage`, `last_error_type: scrapeResult.errorType`.
  - `startDate` for each scrape: `bank_accounts` has no rows yet → 1 year back (max supported by these 4 scrapers per library docs); otherwise a rolling window (e.g. 45 days) back from `last_sync_at` to keep syncs fast — exact window is a dev-agent implementation detail, not user-facing.
  - **Read-only guarantee:** the service exposes exactly one operation per connection — `scrape()` — and must not use any other library capability. No code path performs a write/action against the provider's site.
  - **Runs in-process in `apps/web` on the existing EC2 box** (decision: option (a) from the review). Sync frequency is deliberately low — one scheduled run per day plus on-demand clicks — so the Chromium memory spike is transient. Scrapers must run **sequentially** (one connection at a time, never 4 Chromium instances in parallel), with the browser closed between connections, to stay inside the 1 GB + swap envelope.

## Cron

New route `apps/web/src/app/api/cron/bank-sync/route.ts`, mirroring the existing cron routes' shape (checks `CRON_SECRET` bearer if set, builds a server-side tRPC caller, calls `finance.bankConnections.syncAll`, returns a JSON summary). Schedule (decided): **once daily**, early morning (before `morning-briefing`) — plus the manual per-connection "sync now" button in the UI. No higher frequency. Wiring this into `deploy/crontab.example` / `docs/deploy/cron-setup.md` is a follow-up step at deploy time, not part of this spec's UI/API work.

## UI Surface

- **`apps/web/src/app/finance/page.tsx`:** add `'accounts'` to the `Tab` union, inserted as the **first** entry in the tab bar array (icon `🏦`, label `חשבונות`), rendered via `<Suspense>` + `lazy(() => import('./AccountsTab'))`, matching the existing `VatTab`/`TradingJournalTab` lazy-load pattern. Export the existing `SummaryCard` component from `page.tsx` (currently local) so `AccountsTab` can reuse it instead of duplicating the card markup.
- **New file `apps/web/src/app/finance/AccountsTab.tsx`:**
  - Summary row: 4x `SummaryCard` (total bank balance, total credit card balance, connected accounts count, last sync time) using `trpc.finance.getAccountsSnapshot.useQuery()`.
  - Connections list: one `.card` per `bank_connections` row (via `trpc.finance.bankConnections.list.useQuery()`) showing display name, provider label (הפועלים / אוצר החייל / ויזה כאל / ישראכרט), a status pill reusing the existing `pill` class with the same color convention already used on this page (`#34d399` connected, `#fb7185` error, `#647399` pending/disabled), last sync time (`fmtDate`-style formatting already defined in `page.tsx`), a "🔄 סנכרן עכשיו" `btn btn-ghost` button wired to `bankConnections.sync`, and a "מחק" delete button matching the existing red-ghost delete-button style used in the Cash Flow/Portfolio tables.
  - "+ הוסף חשבון" `btn btn-primary` opens a new modal.
  - Empty state when no connections exist: reuse the existing empty-state pattern (`text-4xl mb-3` emoji + `text-[#5a688c] text-sm` message + a hint line), matching the Cash Flow tab's empty state.
  - Loading state: `<div className="text-[#5a688c] text-sm">טוען...</div>`, matching every other tab.
- **New file `apps/web/src/components/Modals/BankConnectionModal.tsx`:** follows the existing `PersonModal`/`MeetingModal`/`TaskModal` structure (overlay + `.modal` + form + tRPC mutation + close-on-success). Contents: a `<select className="select">` for provider (4 options, Hebrew labels), then conditionally-rendered `.input`/`.label` fields per provider (Hapoalim: קוד משתמש + סיסמה; Otsar HaHayal / Visa Cal: שם משתמש + סיסמה; Isracard: תעודת זהות + 6 ספרות אחרונות של הכרטיס + סיסמה), a display-name `.input`, submit button calling `finance.bankConnections.create`, invalidates `finance.bankConnections.list` and `finance.getAccountsSnapshot` on success. Below the credential fields, a muted hint line (`text-xs text-[#5a688c]`): הגישה לקריאה בלבד — מומלץ להשתמש בהרשאות צפייה בלבד אם הבנק מאפשר.
- **Cash Flow tab (existing, in `page.tsx`):** in the transactions table's "מקור" (source) column, add a third pill option `🏦 בנק` alongside the existing `✏️ ידני` / `📄 CSV`, shown when `t.source === 'bank_scrape'`.
- No changes to `apps/web/src/app/settings/page.tsx` — connection management lives entirely in the new Accounts tab, per "minimize scope."

## Out of Scope

- Mobile app (`apps/mobile`) UI for this feature — web-only for v1.
- Any provider beyond the 4 requested (Hapoalim, Otsar HaHayal, Visa Cal, Isracard). Schema/service layer is written provider-agnostically enough to add more later, but no other provider is wired in this spec.
- Automatic transaction categorization/budget rules for scraped transactions — they land with `category: null`, same manual-categorization workflow as CSV imports today.
- Interactive two-factor/OTP login flows (`otpCodeRetriever`, long-term tokens) — this spec assumes static username/password credentials as documented for these 4 scrapers. If a provider starts requiring interactive 2FA, that needs a follow-up spec.
- Upgrading the Node.js runtime version, or any Docker/EC2 infra changes — called out below as a hard prerequisite, but the infra change itself is not part of this spec.
- A settings page / global secrets UI — credential management happens inline in the Accounts tab only.

## Decisions (open questions resolved 2026-08-03)

1. **Node.js upgrade — approved, bundled with this work.** Both Dockerfiles move to `node:22-bookworm-slim`, root `engines.node` → `>=22.12.0`. Full `pnpm qa` must pass on Node 22 before deploy (now an acceptance criterion).
2. **Scraping runs in-process on the existing EC2 box (option a),** once daily via cron plus on-demand per click — nothing more frequent. Scrapers run sequentially, one Chromium at a time, to respect the 1 GB instance.
3. **Credential storage — AES-256-GCM encrypted in DB** with `BANK_CREDENTIALS_ENCRYPTION_KEY` env secret, as recommended.
4. **Read-only access only.** The service uses only the library's read (`scrape()`) capability; no state-mutating action against any provider, ever. The add-connection UI recommends view-only/inquiry-only credentials where the provider supports them (now an acceptance criterion). Alpir accepts the general automated-login ToS/fraud-detection consideration.
5. **Sync frequency — once daily + manual click** (same as decision 2).
6. **Tab ordering — UI Designer's call: "Accounts" is the first tab** on `/finance`. Rationale: it's the snapshot/at-a-glance surface, the natural landing view of the Finance page; Portfolio/Journal are deeper analysis surfaces.

## Open Questions

None.
