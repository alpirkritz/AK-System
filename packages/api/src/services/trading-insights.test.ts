import { describe, it, expect } from 'vitest'
import {
  computeTradingInsights,
  computeTradingMetrics,
  tradingPeriodSince,
  TRADING_INSIGHT_THRESHOLDS,
  type JournalTrade,
} from './trading-insights'

const NOW = new Date('2026-08-15T12:00:00.000Z')
const T = TRADING_INSIGHT_THRESHOLDS

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

/** A buy followed by a sell of the same size — one closed round trip. */
function roundTrip(
  symbol: string,
  buyPrice: number,
  sellPrice: number,
  buyDate: string,
  sellDate: string,
  commission: number | null = 1
): JournalTrade[] {
  return [
    trade({ symbol, direction: 'buy', price: buyPrice, tradeDate: buyDate, commission }),
    trade({ symbol, direction: 'sell', price: sellPrice, tradeDate: sellDate, commission }),
  ]
}

function kinds(insights: { kind: string }[]): string[] {
  return insights.map((i) => i.kind)
}

describe('tradingPeriodSince', () => {
  it('returns an empty lower bound for all-time', () => {
    expect(tradingPeriodSince('all', NOW)).toBe('')
  })

  it('goes back seven days for a week', () => {
    const since = new Date(tradingPeriodSince('week', NOW)).getTime()
    const days = (NOW.getTime() - since) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it('starts a month at the first of the calendar month', () => {
    const since = new Date(tradingPeriodSince('month', NOW))
    expect(since.getDate()).toBe(1)
    expect(since.getTime()).toBeLessThan(NOW.getTime())
  })

  it('starts a quarter two months earlier than the current month', () => {
    const since = new Date(tradingPeriodSince('quarter', NOW))
    expect(since.getDate()).toBe(1)
    expect(since.getMonth()).toBe(new Date(NOW).getMonth() - 2)
  })
})

describe('computeTradingMetrics', () => {
  it('returns nulls rather than zeros when there is nothing to measure', () => {
    const metrics = computeTradingMetrics([])
    expect(metrics.winRate).toBeNull()
    expect(metrics.profitFactor).toBeNull()
    expect(metrics.avgWin).toBeNull()
    expect(metrics.avgLoss).toBeNull()
    expect(metrics.expectancy).toBeNull()
    expect(metrics.topSymbolPnlShare).toBeNull()
    expect(metrics.positionSizeCv).toBeNull()
    expect(metrics.maxDrawdownRealized).toBe(0)
    expect(metrics.matchedSellsCount).toBe(0)
    expect(metrics.unmatchedSellsCount).toBe(0)
  })

  it('leaves win statistics unmeasured when only buys exist', () => {
    const metrics = computeTradingMetrics([
      trade({ tradeDate: '2026-08-01T00:00:00.000Z' }),
      trade({ symbol: 'MSFT', price: 200, tradeDate: '2026-08-02T00:00:00.000Z' }),
    ])
    expect(metrics.winRate).toBeNull()
    expect(metrics.expectancy).toBeNull()
    expect(metrics.matchedSellsCount).toBe(0)
    expect(metrics.positionSizeCv).not.toBeNull()
  })

  it('measures a single closed round trip', () => {
    const metrics = computeTradingMetrics(
      roundTrip('AAPL', 100, 120, '2026-08-01T00:00:00.000Z', '2026-08-05T00:00:00.000Z', 0)
    )
    expect(metrics.winRate).toBe(100)
    expect(metrics.avgWin).toBe(200)
    expect(metrics.avgLoss).toBeNull()
    expect(metrics.expectancy).toBe(200)
    expect(metrics.matchedSellsCount).toBe(1)
    expect(metrics.avgHoldingDays).toBe(4)
    expect(metrics.medianHoldingDays).toBe(4)
  })

  it('reports profitFactor as null instead of Infinity when nothing lost money', () => {
    const metrics = computeTradingMetrics(
      roundTrip('AAPL', 100, 120, '2026-08-01T00:00:00.000Z', '2026-08-05T00:00:00.000Z', 0)
    )
    expect(metrics.profitFactor).toBeNull()
  })

  it('excludes sells with no matching buy history from every statistic', () => {
    const metrics = computeTradingMetrics([
      trade({ direction: 'sell', price: 150, tradeDate: '2026-08-02T00:00:00.000Z' }),
    ])
    expect(metrics.unmatchedSellsCount).toBe(1)
    expect(metrics.matchedSellsCount).toBe(0)
    expect(metrics.winRate).toBeNull()
    expect(metrics.expectancy).toBeNull()
  })

  it('measures drawdown peak-to-trough over the realized curve', () => {
    const trades = [
      ...roundTrip('AAPL', 100, 110, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', 0),
      ...roundTrip('AAPL', 100, 70, '2026-08-03T00:00:00.000Z', '2026-08-04T00:00:00.000Z', 0),
      ...roundTrip('AAPL', 100, 105, '2026-08-05T00:00:00.000Z', '2026-08-06T00:00:00.000Z', 0),
    ]
    const metrics = computeTradingMetrics(trades)
    // Cumulative realized: +100 → -200 → -150, peak 100.
    expect(metrics.maxDrawdownRealized).toBe(300)
    expect(metrics.winRate).toBe(66.7)
    expect(metrics.profitFactor).toBe(0.5)
    expect(metrics.avgWin).toBe(75)
    expect(metrics.avgLoss).toBe(300)
    expect(metrics.expectancy).toBe(-50)
  })

  it('never produces NaN or Infinity', () => {
    const trades = [
      ...roundTrip('AAPL', 100, 110, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', 0),
      trade({ direction: 'sell', symbol: 'TSLA', tradeDate: '2026-08-03T00:00:00.000Z' }),
    ]
    for (const value of Object.values(computeTradingMetrics(trades))) {
      if (value === null) continue
      expect(Number.isFinite(value as number)).toBe(true)
    }
  })

  it('restricts statistics to the period while still matching against older lots', () => {
    const trades = [
      trade({ direction: 'buy', price: 100, tradeDate: '2026-05-01T00:00:00.000Z', commission: 0 }),
      trade({ direction: 'sell', price: 130, tradeDate: '2026-08-10T00:00:00.000Z', commission: 0 }),
    ]
    const metrics = computeTradingMetrics(trades, { since: '2026-08-01T00:00:00.000Z' })
    expect(metrics.matchedSellsCount).toBe(1)
    expect(metrics.expectancy).toBe(300)
    // The buy predates the period, so only the sell counts towards sizing dispersion.
    expect(metrics.positionSizeCv).toBeNull()
  })
})

describe('computeTradingInsights — concentration', () => {
  it('flags a symbol carrying most of the realized P&L', () => {
    const trades = [
      ...roundTrip('AAPL', 10, 20, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
      ...roundTrip('MSFT', 10, 11, '2026-08-03T00:00:00.000Z', '2026-08-04T00:00:00.000Z'),
    ]
    const { metrics, insights } = computeTradingInsights(trades, 'all', NOW)
    expect(metrics.topSymbolPnlShare).toBeGreaterThanOrEqual(T.concentrationShare)
    const concentration = insights.find((i) => i.kind === 'concentration')
    expect(concentration).toBeDefined()
    expect(concentration?.severity).toBe('warn')
    expect(concentration?.category).toBe('AAPL')
  })

  it('stays silent with a single traded symbol, where concentration is meaningless', () => {
    const trades = roundTrip('AAPL', 10, 20, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z')
    const { metrics, insights } = computeTradingInsights(trades, 'all', NOW)
    expect(metrics.topSymbolPnlShare).toBe(1)
    expect(kinds(insights)).not.toContain('concentration')
  })
})

describe('computeTradingInsights — revenge pattern', () => {
  const losingStreak = [
    ...roundTrip('AAPL', 100, 90, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
    ...roundTrip('AAPL', 100, 90, '2026-08-03T00:00:00.000Z', '2026-08-04T00:00:00.000Z'),
    ...roundTrip('AAPL', 100, 90, '2026-08-05T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
  ]

  it('flags a size-up that follows a losing streak', () => {
    const trades = [
      ...losingStreak,
      trade({ quantity: 30, price: 100, tradeDate: '2026-08-07T00:00:00.000Z' }),
    ]
    const { insights } = computeTradingInsights(trades, 'all', NOW)
    const revenge = insights.find((i) => i.kind === 'revenge_pattern')
    expect(revenge).toBeDefined()
    expect(revenge?.severity).toBe('warn')
    expect(revenge?.amount).toBe(3000)
    expect(revenge?.title).toContain(String(T.revengeLossStreak))
  })

  it('stays silent when the losing streak is not followed by a bigger position', () => {
    const { insights } = computeTradingInsights(losingStreak, 'all', NOW)
    expect(kinds(insights)).not.toContain('revenge_pattern')
  })

  it('stays silent when a big position follows losses that never formed a streak', () => {
    const trades = [
      ...roundTrip('AAPL', 100, 90, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
      ...roundTrip('AAPL', 100, 130, '2026-08-03T00:00:00.000Z', '2026-08-04T00:00:00.000Z'),
      ...roundTrip('AAPL', 100, 90, '2026-08-05T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
      trade({ quantity: 30, price: 100, tradeDate: '2026-08-07T00:00:00.000Z' }),
    ]
    expect(kinds(computeTradingInsights(trades, 'all', NOW).insights)).not.toContain(
      'revenge_pattern'
    )
  })
})

describe('computeTradingInsights — overtrading', () => {
  /** Two old trades stretch the history so the period has a baseline to exceed. */
  const history = [
    trade({ symbol: 'IBM', tradeDate: '2026-06-01T00:00:00.000Z' }),
    trade({ symbol: 'IBM', tradeDate: '2026-06-02T00:00:00.000Z' }),
  ]

  it('flags a burst of trading that lost money', () => {
    const trades = [
      ...history,
      ...roundTrip('AAPL', 100, 90, '2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z'),
      ...roundTrip('MSFT', 100, 90, '2026-08-12T00:00:00.000Z', '2026-08-13T00:00:00.000Z'),
    ]
    const { insights } = computeTradingInsights(trades, 'week', NOW)
    const overtrading = insights.find((i) => i.kind === 'overtrading')
    expect(overtrading).toBeDefined()
    expect(overtrading?.severity).toBe('warn')
    expect(overtrading?.amount).toBeLessThan(0)
  })

  it('stays silent when the busy period was profitable', () => {
    const trades = [
      ...history,
      ...roundTrip('AAPL', 100, 130, '2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z'),
      ...roundTrip('MSFT', 100, 130, '2026-08-12T00:00:00.000Z', '2026-08-13T00:00:00.000Z'),
    ]
    expect(kinds(computeTradingInsights(trades, 'week', NOW).insights)).not.toContain('overtrading')
  })

  it('stays silent for all-time, which has no baseline period to compare against', () => {
    const trades = [
      ...history,
      ...roundTrip('AAPL', 100, 90, '2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z'),
      ...roundTrip('MSFT', 100, 90, '2026-08-12T00:00:00.000Z', '2026-08-13T00:00:00.000Z'),
    ]
    expect(kinds(computeTradingInsights(trades, 'all', NOW).insights)).not.toContain('overtrading')
  })
})

describe('computeTradingInsights — data quality', () => {
  it('admits blindness instead of inventing a commission drag figure', () => {
    const trades = [
      ...roundTrip('AAPL', 100, 120, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', null),
      ...roundTrip('MSFT', 100, 120, '2026-08-03T00:00:00.000Z', '2026-08-04T00:00:00.000Z', 0),
    ]
    const { insights, dataQuality } = computeTradingInsights(trades, 'all', NOW)
    expect(dataQuality.commissionMissingShare).toBeGreaterThan(T.commissionMissingShare)
    expect(insights.find((i) => i.id === 'data_quality:commission')).toBeDefined()
    expect(kinds(insights)).not.toContain('commission_drag')
  })

  it('reports the real commission drag when every commission is known', () => {
    const trades = roundTrip(
      'AAPL',
      100,
      105,
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
      5
    )
    const { insights } = computeTradingInsights(trades, 'all', NOW)
    const drag = insights.find((i) => i.kind === 'commission_drag')
    expect(drag).toBeDefined()
    expect(drag?.severity).toBe('warn')
    expect(drag?.amount).toBe(10)
    expect(kinds(insights)).not.toContain('data_quality')
  })

  it('surfaces sells that have no matching buy history', () => {
    const trades = [
      ...roundTrip('AAPL', 100, 120, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
      trade({ symbol: 'TSLA', direction: 'sell', price: 300, tradeDate: '2026-08-03T00:00:00.000Z' }),
    ]
    const { insights, dataQuality } = computeTradingInsights(trades, 'all', NOW)
    expect(dataQuality.unmatchedSellsCount).toBe(1)
    expect(dataQuality.basedOnMatchedLots).toBe(true)
    expect(insights.find((i) => i.id === 'data_quality:unmatched_lots')).toBeDefined()
  })
})

describe('computeTradingInsights — edge summary', () => {
  function pairs(count: number, sellPrice: number, startDay: number): JournalTrade[] {
    const out: JournalTrade[] = []
    for (let i = 0; i < count; i++) {
      const day = String(startDay + i * 2).padStart(2, '0')
      const nextDay = String(startDay + i * 2 + 1).padStart(2, '0')
      out.push(
        ...roundTrip(
          'AAPL',
          100,
          sellPrice,
          `2026-08-${day}T00:00:00.000Z`,
          `2026-08-${nextDay}T00:00:00.000Z`
        )
      )
    }
    return out
  }

  it('summarises the edge once there are enough matched sells', () => {
    const trades = [...pairs(3, 120, 1), ...pairs(2, 90, 7)]
    const { metrics, insights } = computeTradingInsights(trades, 'all', NOW)
    expect(metrics.matchedSellsCount).toBe(T.edgeSummaryMinSells)
    expect(metrics.winRate).toBe(60)
    const summary = insights.find((i) => i.kind === 'edge_summary')
    expect(summary).toBeDefined()
    expect(summary?.title).toContain('60%')
  })

  it('stays silent below the statistical minimum', () => {
    const { insights } = computeTradingInsights(pairs(2, 120, 1), 'all', NOW)
    expect(kinds(insights)).not.toContain('edge_summary')
  })

  it('produces nothing at all for an empty journal', () => {
    const { insights, dataQuality } = computeTradingInsights([], 'all', NOW)
    expect(insights).toEqual([])
    expect(dataQuality.commissionMissingShare).toBe(0)
  })
})
