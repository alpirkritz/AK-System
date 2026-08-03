import { describe, it, expect, beforeEach } from 'vitest'
import { randomBytes } from 'crypto'
import { getTestDb, createTestCaller } from '../test-utils'
import { bankConnections, bankAccounts, financeTransactions, queryRows, eq } from '@ak-system/database'
import { createContext, createCallerFactory } from '../trpc'
import { appRouter } from '../index'
import type { ScrapeFn } from '../services/bank-sync-service'

const TEST_SESSION = { user: { id: 'test-user', email: 'test@test.com', name: 'Test User' } }

async function createCallerWithScrape(scrape: ScrapeFn) {
  const db = getTestDb()
  const ctx = await createContext({ db, session: TEST_SESSION, bankScrape: scrape })
  return createCallerFactory(appRouter)(ctx)
}

async function resetBankTables() {
  const db = getTestDb()
  await db.delete(financeTransactions)
  await db.delete(bankAccounts)
  await db.delete(bankConnections)
}

describe('finance.bankConnections router', () => {
  beforeEach(async () => {
    process.env.BANK_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    await resetBankTables()
  })

  it('create encrypts credentials; list never exposes them', async () => {
    const caller = await createTestCaller()
    const { id } = await caller.finance.bankConnections.create({
      provider: 'hapoalim',
      displayName: 'הפועלים עו"ש',
      userCode: 'AB1234',
      password: 'super-secret',
    })
    expect(id).toBeTruthy()

    // raw row: encrypted, not plaintext
    const db = getTestDb()
    const raw = await queryRows(db.select().from(bankConnections).where(eq(bankConnections.id, id)))
    expect(raw[0].credentialsEncrypted).toBeTruthy()
    expect(raw[0].credentialsEncrypted).not.toContain('super-secret')
    expect(raw[0].credentialsEncrypted).not.toContain('AB1234')

    // list: no credential fields at all
    const list = await caller.finance.bankConnections.list()
    expect(list).toHaveLength(1)
    expect(list[0]).not.toHaveProperty('credentialsEncrypted')
    expect(list[0]).not.toHaveProperty('credentialsIv')
    expect(JSON.stringify(list[0])).not.toContain('super-secret')
    expect(list[0].provider).toBe('hapoalim')
    expect(list[0].status).toBe('pending')
    expect(list[0].accounts).toEqual([])
  })

  it('create validates isracard card6Digits length', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.finance.bankConnections.create({
        provider: 'isracard',
        displayName: 'ישראכרט',
        id: '012345678',
        card6Digits: '123', // too short
        password: 'pw',
      }),
    ).rejects.toThrow()
  })

  it('sync via router uses injected scraper and updates snapshot', async () => {
    const scrape: ScrapeFn = async () => ({
      success: true,
      accounts: [
        {
          accountNumber: '12-345-678901',
          balance: 5000,
          txns: [
            {
              type: 'normal',
              date: '2026-07-20T00:00:00.000Z',
              processedDate: '2026-07-20T00:00:00.000Z',
              originalAmount: -100,
              originalCurrency: 'ILS',
              chargedAmount: -100,
              description: 'בדיקה',
              status: 'completed',
            },
          ],
        },
      ],
    })
    const caller = await createCallerWithScrape(scrape)
    const { id } = await caller.finance.bankConnections.create({
      provider: 'otsarHahayal',
      displayName: 'אוצר החייל',
      username: 'user',
      password: 'pw',
    })

    const result = await caller.finance.bankConnections.sync({ id })
    expect(result.success).toBe(true)
    expect(result.transactionsInserted).toBe(1)

    const snapshot = await caller.finance.getAccountsSnapshot()
    expect(snapshot.connectedCount).toBe(1)
    expect(snapshot.totalBankBalance).toBe(5000)
    expect(snapshot.accounts).toHaveLength(1)
    expect(snapshot.accounts[0].accountType).toBe('bank')
    expect(snapshot.lastSyncAt).toBeTruthy()

    // scraped txn visible through the regular cash-flow list
    const txns = await caller.finance.listTransactions({ limit: 10 })
    expect(txns.some((t) => t.source === 'bank_scrape' && t.description === 'בדיקה')).toBe(true)
  })

  it('sync returns a friendly error for a missing connection', async () => {
    const caller = await createTestCaller()
    const result = await caller.finance.bankConnections.sync({ id: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('delete removes connection + accounts but keeps transactions (unlinked)', async () => {
    const scrape: ScrapeFn = async () => ({
      success: true,
      accounts: [
        {
          accountNumber: '9999',
          balance: -1500,
          txns: [
            {
              type: 'normal',
              date: '2026-07-01T00:00:00.000Z',
              processedDate: '2026-07-02T00:00:00.000Z',
              originalAmount: -350,
              originalCurrency: 'ILS',
              chargedAmount: -350,
              description: 'מסעדה',
              status: 'completed',
            },
          ],
        },
      ],
    })
    const caller = await createCallerWithScrape(scrape)
    const { id } = await caller.finance.bankConnections.create({
      provider: 'visaCal',
      displayName: 'ויזה כאל',
      username: 'user',
      password: 'pw',
    })
    await caller.finance.bankConnections.sync({ id })

    await caller.finance.bankConnections.delete({ id })

    const db = getTestDb()
    expect(await queryRows(db.select().from(bankConnections))).toHaveLength(0)
    expect(await queryRows(db.select().from(bankAccounts))).toHaveLength(0)

    const txns = await queryRows(db.select().from(financeTransactions))
    expect(txns).toHaveLength(1)
    expect(txns[0].bankAccountId).toBeNull()
    expect(txns[0].source).toBe('bank_scrape')
  })

  it('syncAll skips disabled and aggregates results', async () => {
    const calls: string[] = []
    const scrape: ScrapeFn = async (provider) => {
      calls.push(provider)
      return { success: true, accounts: [] }
    }
    const caller = await createCallerWithScrape(scrape)
    await caller.finance.bankConnections.create({
      provider: 'hapoalim', displayName: 'א', userCode: 'u', password: 'p',
    })
    const { id: disabledId } = await caller.finance.bankConnections.create({
      provider: 'isracard', displayName: 'ב', id: '012345678', card6Digits: '123456', password: 'p',
    })
    const db = getTestDb()
    await db.update(bankConnections).set({ status: 'disabled' }).where(eq(bankConnections.id, disabledId))

    const { results } = await caller.finance.bankConnections.syncAll()
    expect(results).toHaveLength(1)
    expect(calls).toEqual(['hapoalim'])
  })

  it('cryptoConfigured reflects env state', async () => {
    const caller = await createTestCaller()
    expect((await caller.finance.bankConnections.cryptoConfigured()).configured).toBe(true)
    delete process.env.BANK_CREDENTIALS_ENCRYPTION_KEY
    expect((await caller.finance.bankConnections.cryptoConfigured()).configured).toBe(false)
  })
})
