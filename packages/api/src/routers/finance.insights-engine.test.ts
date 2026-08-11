import { describe, it, expect, beforeEach, vi } from 'vitest'

const { generateFinanceNarrative } = vi.hoisted(() => ({ generateFinanceNarrative: vi.fn() }))

vi.mock('../services/finance-narrative', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/finance-narrative')>()
  return { ...actual, generateFinanceNarrative }
})

import { getTestDb, createTestCaller } from '../test-utils'
import {
  financeTrades,
  financeTransactions,
  financeInsightNarratives,
  bankAccounts,
  bankConnections,
  queryRows,
} from '@ak-system/database'

const NOW = new Date()

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

function isoInMonthsAgo(monthsAgo: number, day = 5): string {
  return new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - monthsAgo, day)).toISOString()
}

let seq = 0

async function insertTrade(over: {
  symbol?: string
  direction?: 'buy' | 'sell'
  quantity?: number
  price?: number
  commission?: number | null
  tradeDate: string
}) {
  await getTestDb()
    .insert(financeTrades)
    .values({
      id: `trd${seq++}`,
      symbol: over.symbol ?? 'AAPL',
      direction: over.direction ?? 'buy',
      quantity: String(over.quantity ?? 10),
      price: String(over.price ?? 100),
      commission: over.commission === undefined ? '1' : over.commission === null ? null : String(over.commission),
      currency: 'USD',
      tradeDate: over.tradeDate,
      source: 'ibkr_email',
      rawEmailId: null,
      description: null,
      emailSubject: null,
      actionType: 'trade',
      account: null,
      sourceDetail: null,
      notionPageId: null,
      importedAt: null,
      createdAt: new Date().toISOString(),
    })
}

async function insertTxn(over: {
  amount: number
  direction?: 'income' | 'expense'
  category?: string | null
  description?: string
  transactionDate: string
}) {
  await getTestDb()
    .insert(financeTransactions)
    .values({
      id: `ftx${seq++}`,
      amount: String(over.amount),
      currency: 'ILS',
      direction: over.direction ?? 'expense',
      category: over.category === undefined ? 'מזון' : over.category,
      description: over.description ?? 'סופר',
      transactionDate: over.transactionDate,
      source: 'bank_scrape',
      rawData: null,
      bankAccountId: null,
      dedupeKey: `dk-ie-${seq}`,
      installmentInfo: null,
      txnStatus: 'completed',
      createdAt: new Date().toISOString(),
    })
}

async function insertAccount(over: {
  accountType?: string
  balance?: string | null
  balanceUpdatedAt?: string | null
}) {
  const db = getTestDb()
  const connectionId = `conn${seq++}`
  await db.insert(bankConnections).values({
    id: connectionId,
    provider: 'hapoalim',
    displayName: 'בנק',
    credentialsEncrypted: 'x',
    credentialsIv: 'y',
    status: 'connected',
    lastSyncAt: null,
    lastError: null,
    lastErrorType: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await db.insert(bankAccounts).values({
    id: `acct${seq++}`,
    connectionId,
    accountNumber: '123',
    accountType: over.accountType ?? 'bank',
    balance: over.balance === undefined ? '50000' : over.balance,
    balanceCurrency: 'ILS',
    balanceUpdatedAt: over.balanceUpdatedAt === undefined ? daysAgo(1) : over.balanceUpdatedAt,
    createdAt: new Date().toISOString(),
  })
}

async function reset() {
  const db = getTestDb()
  await db.delete(financeTrades)
  await db.delete(financeTransactions)
  await db.delete(financeInsightNarratives)
  await db.delete(bankAccounts)
  await db.delete(bankConnections)
  generateFinanceNarrative.mockReset()
}

describe('finance.analytics.tradingInsights', () => {
  beforeEach(reset)

  it('returns metrics and insights over the journal', async () => {
    await insertTrade({ tradeDate: daysAgo(20), price: 100 })
    await insertTrade({ direction: 'sell', tradeDate: daysAgo(10), price: 130 })

    const caller = await createTestCaller()
    const result = await caller.finance.analytics.tradingInsights({ period: 'all' })

    expect(result.metrics.matchedSellsCount).toBe(1)
    expect(result.metrics.winRate).toBe(100)
    expect(result.dataQuality.basedOnMatchedLots).toBe(true)
  })

  it('reports an empty journal without inventing numbers', async () => {
    const caller = await createTestCaller()
    const result = await caller.finance.analytics.tradingInsights({ period: 'month' })
    expect(result.metrics.winRate).toBeNull()
    expect(result.metrics.profitFactor).toBeNull()
    expect(result.insights).toEqual([])
  })

  it('treats a missing commission as unknown rather than zero', async () => {
    await insertTrade({ tradeDate: daysAgo(20), commission: null })
    await insertTrade({ direction: 'sell', tradeDate: daysAgo(10), price: 130, commission: null })

    const caller = await createTestCaller()
    const { insights, dataQuality } = await caller.finance.analytics.tradingInsights({ period: 'all' })
    expect(dataQuality.commissionMissingShare).toBe(1)
    expect(insights.find((i) => i.id === 'data_quality:commission')).toBeDefined()
    expect(insights.map((i) => i.kind)).not.toContain('commission_drag')
  })

  it('narrows to the requested period', async () => {
    await insertTrade({ tradeDate: daysAgo(200), price: 100 })
    await insertTrade({ direction: 'sell', tradeDate: daysAgo(190), price: 130 })

    const caller = await createTestCaller()
    expect((await caller.finance.analytics.tradingInsights({ period: 'week' })).metrics.matchedSellsCount).toBe(0)
    expect((await caller.finance.analytics.tradingInsights({ period: 'all' })).metrics.matchedSellsCount).toBe(1)
  })
})

describe('finance.analytics.overview', () => {
  beforeEach(reset)

  it('combines bank, portfolio and runway with an explicit cost valuation', async () => {
    await insertAccount({ balance: '60000' })
    await insertTrade({ tradeDate: daysAgo(40), quantity: 10, price: 170 })
    for (const monthsAgo of [1, 2, 3]) {
      await insertTxn({ amount: 20000, transactionDate: isoInMonthsAgo(monthsAgo) })
    }

    const caller = await createTestCaller()
    const overview = await caller.finance.analytics.overview()

    expect(overview.bankTotal).toBe(60000)
    expect(overview.portfolioCostBasis).toBe(1700)
    expect(overview.avgMonthlyExpense).toBe(20000)
    expect(overview.runwayMonths).toBe(3)
    expect(overview.valuation).toBe('cost')
    expect(overview.stale).toBe(false)
  })

  it('flags a balance nobody has refreshed in over a week', async () => {
    await insertAccount({ balanceUpdatedAt: daysAgo(30) })
    const caller = await createTestCaller()
    expect((await caller.finance.analytics.overview()).stale).toBe(true)
  })

  it('is stale and empty, not broken, with nothing connected', async () => {
    const caller = await createTestCaller()
    const overview = await caller.finance.analytics.overview()
    expect(overview.bankTotal).toBe(0)
    expect(overview.runwayMonths).toBeNull()
    expect(overview.stale).toBe(true)
  })
})

describe('finance.analytics.narrative', () => {
  beforeEach(async () => {
    await reset()
    process.env.GEMINI_API_KEY = 'test-key'
  })

  function narrative(headline = 'כותרת') {
    return {
      headline,
      body: 'גוף הנרטיב',
      connections: ['קשר'],
      watchlist: ['מעקב'],
      model: 'gemini-test',
    }
  }

  it('generates once and serves the cache afterwards', async () => {
    generateFinanceNarrative.mockResolvedValue(narrative())
    await insertTxn({ amount: 1000, transactionDate: isoInMonthsAgo(0) })

    const caller = await createTestCaller()
    const first = await caller.finance.analytics.narrative({ scope: 'cashflow' })
    const second = await caller.finance.analytics.narrative({ scope: 'cashflow' })

    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.headline).toBe('כותרת')
    expect(generateFinanceNarrative).toHaveBeenCalledTimes(1)

    const rows = await queryRows(getTestDb().select().from(financeInsightNarratives))
    expect(rows).toHaveLength(1)
  })

  it('regenerates when the underlying facts change', async () => {
    generateFinanceNarrative.mockResolvedValue(narrative())
    await insertTxn({ amount: 1000, transactionDate: isoInMonthsAgo(0) })

    const caller = await createTestCaller()
    await caller.finance.analytics.narrative({ scope: 'cashflow' })
    await insertTxn({ amount: 7500, transactionDate: isoInMonthsAgo(0) })
    const second = await caller.finance.analytics.narrative({ scope: 'cashflow' })

    expect(second.cached).toBe(false)
    expect(generateFinanceNarrative).toHaveBeenCalledTimes(2)
  })

  it('force bypasses the cache', async () => {
    generateFinanceNarrative.mockResolvedValue(narrative())
    const caller = await createTestCaller()
    await caller.finance.analytics.narrative({ scope: 'overview' })
    const forced = await caller.finance.analytics.narrative({ scope: 'overview', force: true })
    expect(forced.cached).toBe(false)
    expect(generateFinanceNarrative).toHaveBeenCalledTimes(2)
  })

  it('keys the cache per scope, so trading and cash flow do not overwrite each other', async () => {
    generateFinanceNarrative.mockResolvedValue(narrative())
    const caller = await createTestCaller()
    await caller.finance.analytics.narrative({ scope: 'cashflow' })
    await caller.finance.analytics.narrative({ scope: 'trading', period: 'month' })

    const rows = (await queryRows(
      getTestDb().select().from(financeInsightNarratives)
    )) as Array<{ scopeKey: string }>
    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.scopeKey.startsWith('trading:'))).toBe(true)
    expect(rows.some((r) => r.scopeKey.startsWith('cashflow:'))).toBe(true)
  })

  it('refuses politely when Gemini is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    const caller = await createTestCaller()
    await expect(caller.finance.analytics.narrative({ scope: 'cashflow' })).rejects.toThrow(
      /GEMINI_API_KEY/
    )
    expect(generateFinanceNarrative).not.toHaveBeenCalled()
  })

  it('surfaces a generation failure instead of caching a broken narrative', async () => {
    generateFinanceNarrative.mockRejectedValue(new Error('Gemini overloaded'))
    const caller = await createTestCaller()
    await expect(caller.finance.analytics.narrative({ scope: 'cashflow' })).rejects.toThrow(
      /Gemini overloaded/
    )
    expect(await queryRows(getTestDb().select().from(financeInsightNarratives))).toHaveLength(0)
  })
})
