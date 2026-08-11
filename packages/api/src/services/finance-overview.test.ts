import { describe, it, expect } from 'vitest'
import { computeFinanceOverview, type OverviewAccount } from './finance-overview'
import type { AnalyticsTxn } from './cashflow-analytics'
import type { JournalTrade } from './trading-insights'

const NOW = new Date('2026-08-15T12:00:00.000Z')

function account(over: Partial<OverviewAccount> = {}): OverviewAccount {
  return {
    accountType: 'bank',
    balance: 10000,
    balanceCurrency: 'ILS',
    balanceUpdatedAt: '2026-08-14T00:00:00.000Z',
    ...over,
  }
}

function txn(over: Partial<AnalyticsTxn> = {}): AnalyticsTxn {
  return {
    amount: 1000,
    direction: 'expense',
    category: 'מזון',
    description: 'סופר',
    transactionDate: '2026-08-05T00:00:00.000Z',
    ...over,
  }
}

function trade(over: Partial<JournalTrade> = {}): JournalTrade {
  return {
    symbol: 'AAPL',
    direction: 'buy',
    quantity: 10,
    price: 100,
    commission: 1,
    currency: 'USD',
    tradeDate: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function overview(over: Partial<Parameters<typeof computeFinanceOverview>[0]> = {}) {
  return computeFinanceOverview({ accounts: [], trades: [], txns: [], now: NOW, ...over })
}

describe('computeFinanceOverview — bank balances', () => {
  it('sums shekel bank accounts and ignores credit-card lines', () => {
    const result = overview({
      accounts: [
        account({ balance: 8000 }),
        account({ balance: 2000 }),
        account({ accountType: 'credit_card', balance: 5000 }),
      ],
    })
    expect(result.bankTotal).toBe(10000)
  })

  it('ignores accounts whose balance was never scraped', () => {
    expect(overview({ accounts: [account({ balance: null })] }).bankTotal).toBe(0)
  })

  it('reports the freshest balance timestamp', () => {
    const result = overview({
      accounts: [
        account({ balanceUpdatedAt: '2026-08-10T00:00:00.000Z' }),
        account({ balanceUpdatedAt: '2026-08-14T00:00:00.000Z' }),
      ],
    })
    expect(result.asOf).toBe('2026-08-14T00:00:00.000Z')
    expect(result.stale).toBe(false)
  })

  it('marks a balance older than a week as stale', () => {
    expect(overview({ accounts: [account({ balanceUpdatedAt: '2026-08-01T00:00:00.000Z' })] }).stale).toBe(
      true
    )
  })

  it('is stale, not fresh, when there is no balance at all', () => {
    const result = overview()
    expect(result.asOf).toBeNull()
    expect(result.stale).toBe(true)
  })
})

describe('computeFinanceOverview — portfolio at cost', () => {
  it('values what is still held at weighted-average cost', () => {
    const result = overview({
      trades: [
        trade({ quantity: 10, price: 100, tradeDate: '2026-05-01T00:00:00.000Z' }),
        trade({ quantity: 10, price: 120, tradeDate: '2026-06-01T00:00:00.000Z' }),
        trade({ direction: 'sell', quantity: 5, price: 150, tradeDate: '2026-07-01T00:00:00.000Z' }),
      ],
    })
    expect(result.portfolioCostBasis).toBe(1700)
    expect(result.openPositions).toBe(1)
    expect(result.valuation).toBe('cost')
  })

  it('drops a position that was fully sold', () => {
    const result = overview({
      trades: [
        trade({ quantity: 10, price: 100, tradeDate: '2026-05-01T00:00:00.000Z' }),
        trade({ direction: 'sell', quantity: 10, price: 150, tradeDate: '2026-06-01T00:00:00.000Z' }),
      ],
    })
    expect(result.portfolioCostBasis).toBe(0)
    expect(result.openPositions).toBe(0)
  })

  it('reports the currency the journal is actually denominated in', () => {
    expect(overview({ trades: [trade({ currency: 'USD' })] }).portfolioCurrency).toBe('USD')
  })
})

describe('computeFinanceOverview — runway', () => {
  const spending = ['2026-05', '2026-06', '2026-07'].map((m) =>
    txn({ amount: 5000, transactionDate: `${m}-10T00:00:00.000Z` })
  )

  it('divides the bank balance by average monthly spending', () => {
    const result = overview({ accounts: [account({ balance: 20000 })], txns: spending })
    expect(result.avgMonthlyExpense).toBe(5000)
    expect(result.runwayMonths).toBe(4)
  })

  it('excludes internal transfers from the spending baseline', () => {
    const result = overview({
      accounts: [account({ balance: 20000 })],
      txns: [
        ...spending,
        txn({ amount: 50000, category: 'כרטיס אשראי', transactionDate: '2026-07-11T00:00:00.000Z' }),
      ],
    })
    expect(result.avgMonthlyExpense).toBe(5000)
  })

  it('has no runway to report without spending history', () => {
    const result = overview({ accounts: [account({ balance: 20000 })] })
    expect(result.runwayMonths).toBeNull()
    expect(result.avgMonthlyExpense).toBe(0)
  })
})

describe('computeFinanceOverview — savings and broker deposits', () => {
  it('counts money kept, with transfers to a broker shown separately', () => {
    const result = overview({
      txns: [
        txn({ amount: 20000, direction: 'income', category: 'משכורת', transactionDate: '2026-08-01T00:00:00.000Z' }),
        txn({ amount: 8000, transactionDate: '2026-08-03T00:00:00.000Z' }),
        txn({ amount: 5000, category: 'חיסכון והשקעות', description: 'העברה ל-IBKR', transactionDate: '2026-08-04T00:00:00.000Z' }),
      ],
    })
    expect(result.savingsRateInclInvest).toBe(60)
    expect(result.investedThisMonth).toBe(5000)
  })

  it('has no savings rate to report in a month without income', () => {
    expect(overview({ txns: [txn({ amount: 500 })] }).savingsRateInclInvest).toBeNull()
  })

  it('returns a six-month broker deposit trend, oldest first, with empty months as zero', () => {
    const result = overview({
      txns: [
        txn({ amount: 3000, category: 'חיסכון והשקעות', transactionDate: '2026-06-04T00:00:00.000Z' }),
        txn({ amount: 5000, category: 'חיסכון והשקעות', transactionDate: '2026-08-04T00:00:00.000Z' }),
      ],
    })
    expect(result.brokerDepositsTrend).toHaveLength(6)
    expect(result.brokerDepositsTrend[0].month).toBe('2026-03')
    expect(result.brokerDepositsTrend.at(-1)).toEqual({ month: '2026-08', amount: 5000 })
    expect(result.brokerDepositsTrend.find((p) => p.month === '2026-06')?.amount).toBe(3000)
    expect(result.brokerDepositsTrend.find((p) => p.month === '2026-07')?.amount).toBe(0)
  })
})

describe('computeFinanceOverview — currency exposure', () => {
  const trades = [trade({ quantity: 10, price: 170, tradeDate: '2026-05-01T00:00:00.000Z' })]

  it('refuses to add shekels to dollars without an exchange rate', () => {
    const result = overview({ accounts: [account({ balance: 10000 })], trades })
    expect(result.netWorth).toBeNull()
    expect(result.fxExposure).toBeNull()
    expect(result.bankTotal).toBe(10000)
    expect(result.portfolioCostBasis).toBe(1700)
  })

  it('combines them once a rate is supplied', () => {
    const result = overview({ accounts: [account({ balance: 10000 })], trades, usdIls: 3.7 })
    expect(result.netWorth).toBe(16290)
    expect(result.fxExposure).toBe(0.39)
  })

  it('counts a dollar bank account towards the dollar exposure', () => {
    const result = overview({
      accounts: [account({ balance: 10000 }), account({ balance: 1000, balanceCurrency: 'USD' })],
      usdIls: 4,
    })
    expect(result.bankTotal).toBe(10000)
    expect(result.netWorth).toBe(14000)
    expect(result.fxExposure).toBe(0.29)
  })

  it('ignores a nonsensical rate', () => {
    expect(overview({ accounts: [account()], trades, usdIls: 0 }).netWorth).toBeNull()
  })
})
