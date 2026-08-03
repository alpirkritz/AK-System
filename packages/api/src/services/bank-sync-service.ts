/// <reference path="../types/israeli-bank-scrapers.d.ts" />
import { createHash } from 'crypto'
import { eq, and } from 'drizzle-orm'
import {
  getDb,
  bankConnections,
  bankAccounts,
  financeTransactions,
  financeCategoryRules,
  queryRows,
  type BankConnection,
  type BankAccount as BankAccountRow,
  type BankProvider,
} from '@ak-system/database'
import { decryptCredentials } from '../lib/bank-credentials-crypto'
import { categorizeTransaction, type CategoryRule } from './transaction-categorizer'

/**
 * Bank/credit-card account sync via israeli-bank-scrapers.
 *
 * READ-ONLY GUARANTEE: this service calls exactly one library operation —
 * `scrape()` — which reads balances and transactions. No code path performs
 * any state-mutating action against a provider's site.
 *
 * Scrapers run SEQUENTIALLY (one Chromium at a time) — see syncAllConnections.
 * The production box is a 1 GB EC2 instance; never parallelize this.
 */

type Db = ReturnType<typeof getDb>

// ── Scraper contract (mirrors israeli-bank-scrapers' result shape) ─────────

export interface ScrapedTransaction {
  type: string // 'normal' | 'installments'
  identifier?: number | string
  date: string // ISO
  processedDate: string // ISO
  originalAmount: number
  originalCurrency: string
  chargedAmount: number
  description: string
  memo?: string | null
  installments?: { number: number; total: number }
  status: string // 'completed' | 'pending'
}

export interface ScrapedAccount {
  accountNumber: string
  balance?: number
  txns: ScrapedTransaction[]
}

export interface ScrapeOutcome {
  success: boolean
  accounts?: ScrapedAccount[]
  errorType?: string
  errorMessage?: string
}

export type ScrapeFn = (
  provider: BankProvider,
  credentials: Record<string, string>,
  startDate: Date,
) => Promise<ScrapeOutcome>

/** bank vs credit card, derived from provider */
export function accountTypeForProvider(provider: BankProvider): 'bank' | 'credit_card' {
  return provider === 'hapoalim' || provider === 'otsarHahayal' ? 'bank' : 'credit_card'
}

/** Stable dedupe key so repeat syncs skip already-imported transactions */
export function transactionDedupeKey(
  accountNumber: string,
  txn: Pick<ScrapedTransaction, 'date' | 'chargedAmount' | 'description'>,
): string {
  return createHash('sha256')
    .update(`${accountNumber}|${txn.date}|${txn.chargedAmount}|${txn.description}`)
    .digest('hex')
}

/**
 * Real scraper implementation. Dynamic import keeps puppeteer/chromium out of
 * the Next.js build graph and out of test runs (tests inject a fake ScrapeFn).
 */
export const realScrape: ScrapeFn = async (provider, credentials, startDate) => {
  const { createScraper, CompanyTypes } = await import('israeli-bank-scrapers')
  const companyId = CompanyTypes[provider]
  const scraper = createScraper({
    companyId,
    startDate,
    combineInstallments: false,
    showBrowser: false,
  })
  // READ-ONLY: scrape() is the only operation ever invoked on the scraper.
  const result = await scraper.scrape(credentials as never)
  return result as unknown as ScrapeOutcome
}

export interface SyncResult {
  success: boolean
  accountsSynced: number
  transactionsInserted: number
  error?: string
}

/** How far back to scrape: 1 year on first sync, 45 days after that. */
export function computeStartDate(hasExistingAccounts: boolean, now = new Date()): Date {
  const d = new Date(now)
  if (hasExistingAccounts) d.setDate(d.getDate() - 45)
  else d.setFullYear(d.getFullYear() - 1)
  return d
}

export async function syncConnection(
  db: Db,
  connection: BankConnection,
  scrape: ScrapeFn = realScrape,
): Promise<SyncResult> {
  const nowIso = () => new Date().toISOString()

  let credentials: Record<string, string>
  try {
    credentials = decryptCredentials(connection.credentialsEncrypted, connection.credentialsIv)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to decrypt credentials'
    await db
      .update(bankConnections)
      .set({ status: 'error', lastError: msg, lastErrorType: 'GENERIC', updatedAt: nowIso() })
      .where(eq(bankConnections.id, connection.id))
    return { success: false, accountsSynced: 0, transactionsInserted: 0, error: msg }
  }

  const existingAccounts = (await queryRows(
    db.select().from(bankAccounts).where(eq(bankAccounts.connectionId, connection.id)),
  )) as BankAccountRow[]
  const startDate = computeStartDate(existingAccounts.length > 0)

  let outcome: ScrapeOutcome
  try {
    outcome = await scrape(connection.provider as BankProvider, credentials, startDate)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Scrape failed'
    await db
      .update(bankConnections)
      .set({ status: 'error', lastError: msg, lastErrorType: 'UNKNOWN_ERROR', updatedAt: nowIso() })
      .where(eq(bankConnections.id, connection.id))
    return { success: false, accountsSynced: 0, transactionsInserted: 0, error: msg }
  }

  if (!outcome.success) {
    const msg = outcome.errorMessage || outcome.errorType || 'Scrape failed'
    await db
      .update(bankConnections)
      .set({
        status: 'error',
        lastError: msg,
        lastErrorType: outcome.errorType ?? 'GENERIC',
        updatedAt: nowIso(),
      })
      .where(eq(bankConnections.id, connection.id))
    return { success: false, accountsSynced: 0, transactionsInserted: 0, error: msg }
  }

  const accounts = outcome.accounts ?? []
  const accountType = accountTypeForProvider(connection.provider as BankProvider)
  let transactionsInserted = 0

  // Loaded once per sync so every inserted row arrives categorized, instead of leaving the
  // analytics tab with a backlog to clean up after each sync.
  const categoryRules = (await queryRows(
    db.select().from(financeCategoryRules),
  )) as Array<{ pattern: string; category: string; direction: string | null }>
  const rules: CategoryRule[] = categoryRules.map((r) => ({
    pattern: r.pattern,
    category: r.category,
    direction: r.direction === 'income' || r.direction === 'expense' ? r.direction : null,
  }))

  for (const account of accounts) {
    // Upsert bank_accounts row by (connection_id, account_number)
    const existing = (await queryRows(
      db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.connectionId, connection.id),
            eq(bankAccounts.accountNumber, account.accountNumber),
          ),
        ),
    )) as BankAccountRow[]
    let accountId: string
    if (existing.length > 0) {
      accountId = existing[0].id
      await db
        .update(bankAccounts)
        .set({
          balance: account.balance != null ? String(account.balance) : existing[0].balance,
          balanceUpdatedAt: account.balance != null ? nowIso() : existing[0].balanceUpdatedAt,
        })
        .where(eq(bankAccounts.id, accountId))
    } else {
      accountId = 'ba' + Date.now() + Math.random().toString(36).slice(2, 7)
      await db.insert(bankAccounts).values({
        id: accountId,
        connectionId: connection.id,
        accountNumber: account.accountNumber,
        accountType,
        balance: account.balance != null ? String(account.balance) : null,
        balanceCurrency: 'ILS',
        balanceUpdatedAt: account.balance != null ? nowIso() : null,
        createdAt: nowIso(),
      })
    }

    for (const txn of account.txns) {
      const dedupeKey = transactionDedupeKey(account.accountNumber, txn)
      const dupes = (await queryRows(
        db
          .select({ id: financeTransactions.id })
          .from(financeTransactions)
          .where(eq(financeTransactions.dedupeKey, dedupeKey)),
      )) as Array<{ id: string }>
      if (dupes.length > 0) continue

      const amount = Math.abs(txn.chargedAmount)
      if (!amount) continue
      const direction = txn.chargedAmount >= 0 ? 'income' : 'expense'
      const description = txn.description + (txn.memo ? ` — ${txn.memo}` : '')
      await db.insert(financeTransactions).values({
        id: 'fx' + Date.now() + Math.random().toString(36).slice(2, 7),
        amount: String(amount),
        currency: txn.originalCurrency || 'ILS',
        direction,
        category: categorizeTransaction(description, rules, direction),
        description,
        transactionDate: txn.date,
        source: 'bank_scrape',
        rawData: null,
        bankAccountId: accountId,
        dedupeKey,
        installmentInfo: txn.installments ? JSON.stringify(txn.installments) : null,
        txnStatus: txn.status === 'pending' ? 'pending' : 'completed',
        createdAt: nowIso(),
      })
      transactionsInserted++
    }
  }

  await db
    .update(bankConnections)
    .set({
      status: 'connected',
      lastSyncAt: nowIso(),
      lastError: null,
      lastErrorType: null,
      updatedAt: nowIso(),
    })
    .where(eq(bankConnections.id, connection.id))

  return { success: true, accountsSynced: accounts.length, transactionsInserted }
}

/** Sync every non-disabled connection, strictly one at a time (memory constraint). */
export async function syncAllConnections(
  db: Db,
  scrape: ScrapeFn = realScrape,
): Promise<Array<SyncResult & { connectionId: string }>> {
  const rows = (await queryRows(db.select().from(bankConnections))) as BankConnection[]
  const results: Array<SyncResult & { connectionId: string }> = []
  for (const connection of rows) {
    if (connection.status === 'disabled') continue
    const result = await syncConnection(db, connection, scrape)
    results.push({ connectionId: connection.id, ...result })
  }
  return results
}
