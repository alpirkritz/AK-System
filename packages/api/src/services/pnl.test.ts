import { describe, expect, it } from 'vitest'
import { computeFifoPnl, type TradeInput } from './pnl'
import { formatImportReport } from './ibkr-import-service'

function buy(symbol: string, quantity: number, price: number, date: string, commission = 0): TradeInput {
  return { symbol, direction: 'buy', quantity, price, commission, tradeDate: date }
}
function sell(symbol: string, quantity: number, price: number, date: string, commission = 0): TradeInput {
  return { symbol, direction: 'sell', quantity, price, commission, tradeDate: date }
}

describe('computeFifoPnl', () => {
  it('computes realized P&L for a simple buy then sell', () => {
    const { bySymbol } = computeFifoPnl([
      buy('AAPL', 10, 100, '2026-01-01'),
      sell('AAPL', 10, 120, '2026-01-05'),
    ])
    expect(bySymbol.AAPL!.realizedPnl).toBeCloseTo(200, 6)
    expect(bySymbol.AAPL!.sharesOwned).toBe(0)
  })

  it('subtracts commission from realized P&L', () => {
    const { bySymbol } = computeFifoPnl([
      buy('AAPL', 10, 100, '2026-01-01'),
      sell('AAPL', 10, 120, '2026-01-05', 15),
    ])
    expect(bySymbol.AAPL!.realizedPnl).toBeCloseTo(185, 6)
  })

  it('matches sells against oldest lots first (FIFO)', () => {
    const { bySymbol } = computeFifoPnl([
      buy('AAPL', 10, 100, '2026-01-01'),
      buy('AAPL', 10, 200, '2026-01-02'),
      sell('AAPL', 10, 150, '2026-01-03'),
    ])
    // sold 10 against the 100 lot: (150-100)*10 = 500
    expect(bySymbol.AAPL!.realizedPnl).toBeCloseTo(500, 6)
    // 10 shares of the 200 lot remain
    expect(bySymbol.AAPL!.sharesOwned).toBe(10)
    expect(bySymbol.AAPL!.avgCost).toBeCloseTo(200, 6)
  })

  it('reports a loss when selling below cost', () => {
    const { bySymbol } = computeFifoPnl([
      buy('TSLA', 5, 300, '2026-02-01'),
      sell('TSLA', 5, 250, '2026-02-02'),
    ])
    expect(bySymbol.TSLA!.realizedPnl).toBeCloseTo(-250, 6)
  })

  it('handles sells with no prior buy history (zero cost basis)', () => {
    const { bySymbol, sells } = computeFifoPnl([sell('MSTR', 2, 400, '2026-03-01')])
    expect(sells).toHaveLength(1)
    expect(sells[0]!.costBasis).toBe(0)
    expect(bySymbol.MSTR!.realizedPnl).toBeCloseTo(800, 6)
  })

  it('respects chronological order regardless of input order', () => {
    const { bySymbol } = computeFifoPnl([
      sell('NVDA', 10, 150, '2026-01-03'),
      buy('NVDA', 10, 100, '2026-01-01'),
    ])
    expect(bySymbol.NVDA!.realizedPnl).toBeCloseTo(500, 6)
    expect(bySymbol.NVDA!.sharesOwned).toBe(0)
  })

  it('attaches per-sell realized P&L with trade ids for the daily view', () => {
    const { sells } = computeFifoPnl([
      { id: 'b1', ...buy('AAPL', 10, 100, '2026-01-01') },
      { id: 's1', ...sell('AAPL', 4, 130, '2026-01-05') },
    ])
    expect(sells).toHaveLength(1)
    expect(sells[0]!.id).toBe('s1')
    expect(sells[0]!.realizedPnl).toBeCloseTo(120, 6)
  })
})

describe('formatImportReport', () => {
  it('reports when nothing was found', () => {
    expect(formatImportReport({ inserted: 0, skipped: 0, total: 0, subjects: [] })).toContain('לא נמצאו')
  })

  it('reports skipped duplicates with no new inserts', () => {
    const text = formatImportReport({ inserted: 0, skipped: 3, total: 3, subjects: [] })
    expect(text).toContain('3')
  })

  it('lists imported subjects', () => {
    const text = formatImportReport({
      inserted: 2,
      skipped: 1,
      total: 3,
      subjects: ['SOLD 10 AAPL @ 120', 'BOUGHT 5 TSLA @ 300'],
    })
    expect(text).toContain('יובאו 2')
    expect(text).toContain('SOLD 10 AAPL @ 120')
  })
})
