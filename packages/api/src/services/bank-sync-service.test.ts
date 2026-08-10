import { describe, it, expect, beforeEach } from 'vitest'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { getTestDb } from '../test-utils'
import { bankConnections, bankAccounts, financeTransactions, queryRows } from '@ak-system/database'
import { encryptCredentials } from '../lib/bank-credentials-crypto'
import {
  syncConnection,
  syncAllConnections,
  transactionDedupeKey,
  accountTypeForProvider,
  computeStartDate,
  CHROMIUM_LAUNCH_ARGS,
  maskHeadlessUserAgent,
  type ScrapeFn,
  type ScrapeOutcome,
} from './bank-sync-service'

async function resetBankTables() {
  const db = getTestDb()
  await db.delete(financeTransactions)
  await db.delete(bankAccounts)
  await db.delete(bankConnections)
}

async function insertConnection(provider = 'hapoalim', status = 'pending') {
  const db = getTestDb()
  const { encrypted, iv } = encryptCredentials({ userCode: 'AB1234', password: 'secret' })
  const id = 'bc-test-' + Math.random().toString(36).slice(2, 8)
  const now = new Date().toISOString()
  await db.insert(bankConnections).values({
    id,
    provider,
    displayName: 'חשבון בדיקה',
    credentialsEncrypted: encrypted,
    credentialsIv: iv,
    status,
    createdAt: now,
    updatedAt: now,
  })
  const rows = await queryRows(db.select().from(bankConnections).where(eq(bankConnections.id, id)))
  return rows[0]
}

const SAMPLE_OUTCOME: ScrapeOutcome = {
  success: true,
  accounts: [
    {
      accountNumber: '12-345-678901',
      balance: 15250.75,
      txns: [
        {
          type: 'normal',
          date: '2026-07-20T00:00:00.000Z',
          processedDate: '2026-07-21T00:00:00.000Z',
          originalAmount: -250.5,
          originalCurrency: 'ILS',
          chargedAmount: -250.5,
          description: 'סופר יוחננוף',
          memo: null,
          status: 'completed',
        },
        {
          type: 'normal',
          date: '2026-07-25T00:00:00.000Z',
          processedDate: '2026-07-25T00:00:00.000Z',
          originalAmount: 12000,
          originalCurrency: 'ILS',
          chargedAmount: 12000,
          description: 'משכורת',
          memo: null,
          status: 'completed',
        },
      ],
    },
  ],
}

describe('bank-sync-service', () => {
  beforeEach(async () => {
    process.env.BANK_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    await resetBankTables()
  })

  describe('helpers', () => {
    it('CHROMIUM_LAUNCH_ARGS includes Docker-safe flags', () => {
      expect(CHROMIUM_LAUNCH_ARGS).toContain('--no-sandbox')
      expect(CHROMIUM_LAUNCH_ARGS).toContain('--disable-setuid-sandbox')
      expect(CHROMIUM_LAUNCH_ARGS).toContain('--disable-dev-shm-usage')
    })

    it('maskHeadlessUserAgent replaces HeadlessChrome in UA', async () => {
      let setUa = ''
      await maskHeadlessUserAgent({
        evaluate: async () =>
          'Mozilla/5.0 HeadlessChrome/148.0.0.0 Safari/537.36',
        setUserAgent: async (ua) => {
          setUa = ua
        },
      })
      expect(setUa).toContain('Chrome/148')
      expect(setUa).not.toContain('HeadlessChrome')
    })

    it('accountTypeForProvider maps banks vs credit cards', () => {
      expect(accountTypeForProvider('hapoalim')).toBe('bank')
      expect(accountTypeForProvider('otsarHahayal')).toBe('bank')
      expect(accountTypeForProvider('visaCal')).toBe('credit_card')
      expect(accountTypeForProvider('isracard')).toBe('credit_card')
    })

    it('transactionDedupeKey is stable for same txn and differs otherwise', () => {
      const txn = { date: '2026-07-20', chargedAmount: -100, description: 'קניות' }
      expect(transactionDedupeKey('acc1', txn)).toBe(transactionDedupeKey('acc1', txn))
      expect(transactionDedupeKey('acc2', txn)).not.toBe(transactionDedupeKey('acc1', txn))
      expect(transactionDedupeKey('acc1', { ...txn, chargedAmount: -101 })).not.toBe(
        transactionDedupeKey('acc1', txn),
      )
    })

    it('computeStartDate: 1 year back on first sync, 45 days after', () => {
      const now = new Date('2026-08-03T00:00:00Z')
      expect(computeStartDate(false, now).getFullYear()).toBe(2025)
      const rolling = computeStartDate(true, now)
      const diffDays = (now.getTime() - rolling.getTime()) / 86400000
      expect(Math.round(diffDays)).toBe(45)
    })
  })

  describe('syncConnection', () => {
    it('inserts accounts + transactions and marks the connection connected', async () => {
      const db = getTestDb()
      const connection = await insertConnection()
      const scrape: ScrapeFn = async () => SAMPLE_OUTCOME

      const result = await syncConnection(db, connection, scrape)
      expect(result.success).toBe(true)
      expect(result.accountsSynced).toBe(1)
      expect(result.transactionsInserted).toBe(2)

      const accounts = await queryRows(db.select().from(bankAccounts))
      expect(accounts).toHaveLength(1)
      expect(accounts[0].accountType).toBe('bank')
      expect(accounts[0].balance).toBe('15250.75')

      const txns = await queryRows(db.select().from(financeTransactions))
      expect(txns).toHaveLength(2)
      const expense = txns.find((t) => t.direction === 'expense')!
      expect(expense.amount).toBe('250.5')
      expect(expense.source).toBe('bank_scrape')
      expect(expense.bankAccountId).toBe(accounts[0].id)
      // Categorized inline on insert so the analytics tab has no backlog after a sync.
      expect(expense.category).toBe('מזון')
      const income = txns.find((t) => t.direction === 'income')!
      expect(income.amount).toBe('12000')
      expect(income.category).toBe('משכורת')

      const updated = await queryRows(
        db.select().from(bankConnections).where(eq(bankConnections.id, connection.id)),
      )
      expect(updated[0].status).toBe('connected')
      expect(updated[0].lastSyncAt).toBeTruthy()
      expect(updated[0].lastError).toBeNull()
    })

    it('re-running the same sync inserts no duplicates (dedupe)', async () => {
      const db = getTestDb()
      const connection = await insertConnection()
      const scrape: ScrapeFn = async () => SAMPLE_OUTCOME

      const first = await syncConnection(db, connection, scrape)
      expect(first.transactionsInserted).toBe(2)
      const second = await syncConnection(db, connection, scrape)
      expect(second.success).toBe(true)
      expect(second.transactionsInserted).toBe(0)

      const txns = await queryRows(db.select().from(financeTransactions))
      expect(txns).toHaveLength(2)
      const accounts = await queryRows(db.select().from(bankAccounts))
      expect(accounts).toHaveLength(1)
    })

    it('records scraper failure on the connection', async () => {
      const db = getTestDb()
      const connection = await insertConnection()
      const scrape: ScrapeFn = async () => ({
        success: false,
        errorType: 'INVALID_PASSWORD',
        errorMessage: 'הסיסמה שגויה',
      })

      const result = await syncConnection(db, connection, scrape)
      expect(result.success).toBe(false)
      expect(result.error).toBe('הסיסמה שגויה')

      const rows = await queryRows(
        db.select().from(bankConnections).where(eq(bankConnections.id, connection.id)),
      )
      expect(rows[0].status).toBe('error')
      expect(rows[0].lastErrorType).toBe('INVALID_PASSWORD')
    })

    it('records thrown scraper errors without crashing', async () => {
      const db = getTestDb()
      const connection = await insertConnection()
      const scrape: ScrapeFn = async () => {
        throw new Error('chromium crashed')
      }
      const result = await syncConnection(db, connection, scrape)
      expect(result.success).toBe(false)
      expect(result.error).toBe('chromium crashed')
      const rows = await queryRows(
        db.select().from(bankConnections).where(eq(bankConnections.id, connection.id)),
      )
      expect(rows[0].status).toBe('error')
    })

    it('credit card providers store credit_card account type + expense direction', async () => {
      const db = getTestDb()
      const connection = await insertConnection('visaCal')
      const scrape: ScrapeFn = async () => ({
        success: true,
        accounts: [
          {
            accountNumber: '1234',
            balance: -3200,
            txns: [
              {
                type: 'installments',
                date: '2026-07-10T00:00:00.000Z',
                processedDate: '2026-08-02T00:00:00.000Z',
                originalAmount: -1200,
                originalCurrency: 'ILS',
                chargedAmount: -400,
                description: 'ריהוט',
                installments: { number: 1, total: 3 },
                status: 'completed',
              },
            ],
          },
        ],
      })

      const result = await syncConnection(db, connection, scrape)
      expect(result.success).toBe(true)
      const accounts = await queryRows(db.select().from(bankAccounts))
      expect(accounts[0].accountType).toBe('credit_card')
      const txns = await queryRows(db.select().from(financeTransactions))
      expect(txns[0].direction).toBe('expense')
      expect(txns[0].installmentInfo).toBe(JSON.stringify({ number: 1, total: 3 }))
    })
  })

  describe('syncAllConnections', () => {
    it('syncs sequentially, skipping disabled connections', async () => {
      const db = getTestDb()
      await insertConnection('hapoalim')
      await insertConnection('visaCal')
      await insertConnection('isracard', 'disabled')

      const calls: string[] = []
      let inFlight = 0
      let maxInFlight = 0
      const scrape: ScrapeFn = async (provider) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        calls.push(provider)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return { success: true, accounts: [] }
      }

      const results = await syncAllConnections(db, scrape)
      expect(results).toHaveLength(2)
      expect(calls).toHaveLength(2)
      expect(calls).not.toContain('isracard')
      expect(maxInFlight).toBe(1) // strictly sequential — never parallel
    })
  })
})
