import { describe, it, expect } from 'vitest'
import {
  buildMonthlyTrend,
  buildCategoryBreakdown,
  detectRecurring,
  computeInsights,
  monthWindow,
  previousMonths,
  monthKey,
  normalizeDescription,
  type AnalyticsTxn,
} from './cashflow-analytics'

const NOW = new Date('2026-08-15T12:00:00.000Z')

function txn(over: Partial<AnalyticsTxn> = {}): AnalyticsTxn {
  return {
    amount: 100,
    direction: 'expense',
    category: 'מזון',
    description: 'סופר יוחננוף',
    transactionDate: '2026-08-05T00:00:00.000Z',
    ...over,
  }
}

describe('month helpers', () => {
  it('monthKey uses Asia/Jerusalem (Israel midnight stored as …T21:00Z)', () => {
    // 2026-07-31 21:00 UTC = 2026-08-01 00:00 Israel (DST UTC+3)
    expect(monthKey('2026-07-31T21:00:00.000Z')).toBe('2026-08')
    expect(monthKey('2026-08-01T21:00:00.000Z')).toBe('2026-08')
  })

  it('monthWindow returns keys oldest first, inclusive of the current month', () => {
    expect(monthWindow(3, NOW)).toEqual(['2026-06', '2026-07', '2026-08'])
  })

  it('monthWindow crosses a year boundary', () => {
    expect(monthWindow(3, new Date('2026-01-10T00:00:00.000Z'))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ])
  })

  it('previousMonths excludes the reference month', () => {
    expect(previousMonths('2026-03', 3)).toEqual(['2026-02', '2026-01', '2025-12'])
  })
})

describe('normalizeDescription', () => {
  it('strips digits and punctuation so branch codes do not split a merchant', () => {
    expect(normalizeDescription('סופר יוחננוף 1234')).toBe('סופר יוחננוף')
    expect(normalizeDescription('סופר יוחננוף - סניף 77')).toBe('סופר יוחננוף סניף')
  })

  it('strips Israeli installment counters', () => {
    expect(normalizeDescription('רהיטים תשלום 3 מתוך 12')).toBe('רהיטים')
  })

  it('caps at four words so long descriptions still group', () => {
    expect(normalizeDescription('אחת שתיים שלוש ארבע חמש שש')).toBe('אחת שתיים שלוש ארבע')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeDescription(null)).toBe('')
  })
})

describe('buildMonthlyTrend', () => {
  it('sums income and expense per month and derives net', () => {
    const result = buildMonthlyTrend(
      [
        txn({ direction: 'income', amount: 12000, category: 'משכורת', transactionDate: '2026-08-01T00:00:00.000Z' }),
        txn({ amount: 300, transactionDate: '2026-08-03T00:00:00.000Z' }),
        txn({ amount: 200, transactionDate: '2026-08-09T00:00:00.000Z' }),
      ],
      3,
      NOW
    )

    const august = result.find((p) => p.month === '2026-08')!
    expect(august.income).toBe(12000)
    expect(august.expense).toBe(500)
    expect(august.net).toBe(11500)
  })

  it('includes months with no transactions as zeros rather than omitting them', () => {
    const result = buildMonthlyTrend([txn({ transactionDate: '2026-08-05T00:00:00.000Z' })], 3, NOW)
    expect(result.map((p) => p.month)).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(result[0]).toEqual({ month: '2026-06', income: 0, expense: 0, net: 0 })
  })

  it('excludes internal categories so a card charge is not double counted', () => {
    const result = buildMonthlyTrend(
      [
        txn({ amount: 5000, category: 'כרטיס אשראי' }),
        txn({ amount: 400, category: 'העברות' }),
        txn({ amount: 250, category: 'מזון' }),
      ],
      1,
      NOW
    )
    expect(result[0].expense).toBe(250)
  })

  it('ignores transactions outside the window', () => {
    const result = buildMonthlyTrend([txn({ transactionDate: '2024-01-05T00:00:00.000Z' })], 3, NOW)
    expect(result.every((p) => p.expense === 0)).toBe(true)
  })
})

describe('buildCategoryBreakdown', () => {
  const txns: AnalyticsTxn[] = [
    // current month
    txn({ category: 'מזון', amount: 900, transactionDate: '2026-08-02T00:00:00.000Z' }),
    txn({ category: 'אוכל בחוץ', amount: 600, transactionDate: '2026-08-04T00:00:00.000Z' }),
    // trailing three months: 300 per month on מזון
    txn({ category: 'מזון', amount: 300, transactionDate: '2026-07-02T00:00:00.000Z' }),
    txn({ category: 'מזון', amount: 300, transactionDate: '2026-06-02T00:00:00.000Z' }),
    txn({ category: 'מזון', amount: 300, transactionDate: '2026-05-02T00:00:00.000Z' }),
  ]

  it('totals the selected month only and sorts by size', () => {
    const { total, items } = buildCategoryBreakdown(txns, '2026-08')
    expect(total).toBe(1500)
    expect(items.map((i) => i.category)).toEqual(['מזון', 'אוכל בחוץ'])
  })

  it('computes share of the month', () => {
    const { items } = buildCategoryBreakdown(txns, '2026-08')
    expect(items[0].share).toBe(60)
    expect(items[1].share).toBe(40)
  })

  it('compares each category to its own trailing three-month average', () => {
    const { items } = buildCategoryBreakdown(txns, '2026-08')
    const food = items.find((i) => i.category === 'מזון')!
    expect(food.trailingAvg).toBe(300)
    expect(food.deltaAbs).toBe(600)
    expect(food.deltaPct).toBe(200)
  })

  it('reports deltaPct as null when there is no history to compare against', () => {
    const { items } = buildCategoryBreakdown(txns, '2026-08')
    const dining = items.find((i) => i.category === 'אוכל בחוץ')!
    expect(dining.trailingAvg).toBe(0)
    expect(dining.deltaPct).toBeNull()
  })

  it('labels missing categories rather than dropping the money', () => {
    const { items } = buildCategoryBreakdown(
      [txn({ category: null, amount: 500, transactionDate: '2026-08-02T00:00:00.000Z' })],
      '2026-08'
    )
    expect(items[0].category).toBe('ללא סיווג')
    expect(items[0].total).toBe(500)
  })

  it('omits categories with no data in the month instead of showing zero rows', () => {
    const { items } = buildCategoryBreakdown(txns, '2026-07')
    expect(items.map((i) => i.category)).toEqual(['מזון'])
  })

  it('separates income from expense', () => {
    const { items } = buildCategoryBreakdown(
      [
        txn({ direction: 'income', category: 'משכורת', amount: 12000, transactionDate: '2026-08-01T00:00:00.000Z' }),
        txn({ category: 'מזון', amount: 100, transactionDate: '2026-08-01T00:00:00.000Z' }),
      ],
      '2026-08',
      'income'
    )
    expect(items).toHaveLength(1)
    expect(items[0].category).toBe('משכורת')
  })
})

describe('detectRecurring', () => {
  function monthlySeries(description: string, amounts: number[], category = 'מנויים'): AnalyticsTxn[] {
    return amounts.map((amount, i) =>
      txn({
        description,
        category,
        amount,
        transactionDate: new Date(Date.UTC(2026, 2 + i, 5)).toISOString(),
      })
    )
  }

  it('requires the minimum number of occurrences', () => {
    const { items } = detectRecurring(monthlySeries('נטפליקס', [50, 50]), { now: NOW })
    expect(items).toHaveLength(0)
  })

  it('detects a monthly cadence and annualizes it', () => {
    const { items } = detectRecurring(monthlySeries('נטפליקס', [50, 50, 50, 50]), { now: NOW })
    expect(items).toHaveLength(1)
    expect(items[0].cadence).toBe('monthly')
    expect(items[0].occurrences).toBe(4)
    expect(items[0].avgAmount).toBe(50)
    expect(items[0].annualizedCost).toBe(600)
  })

  it('flags a price increase above 10% against the prior average', () => {
    const { items } = detectRecurring(monthlySeries('נטפליקס', [50, 50, 50, 70]), { now: NOW })
    expect(items[0].increasedPct).toBeCloseTo(40, 0)
  })

  it('does not flag an increase within the noise threshold', () => {
    const { items } = detectRecurring(monthlySeries('נטפליקס', [50, 50, 50, 52]), { now: NOW })
    expect(items[0].increasedPct).toBeNull()
  })

  it('classifies an inconsistent gap as irregular', () => {
    const irregular = [
      txn({ description: 'רהיטים', transactionDate: '2026-03-01T00:00:00.000Z', amount: 100 }),
      txn({ description: 'רהיטים', transactionDate: '2026-03-04T00:00:00.000Z', amount: 100 }),
      txn({ description: 'רהיטים', transactionDate: '2026-03-07T00:00:00.000Z', amount: 100 }),
    ]
    const { items } = detectRecurring(irregular, { now: NOW })
    expect(items[0].cadence).toBe('irregular')
  })

  it('a single skipped month does not reclassify a monthly commitment', () => {
    const withGap = [
      txn({ description: 'חדר כושר', transactionDate: '2026-04-05T00:00:00.000Z', amount: 200 }),
      txn({ description: 'חדר כושר', transactionDate: '2026-05-05T00:00:00.000Z', amount: 200 }),
      txn({ description: 'חדר כושר', transactionDate: '2026-07-05T00:00:00.000Z', amount: 200 }),
      txn({ description: 'חדר כושר', transactionDate: '2026-08-05T00:00:00.000Z', amount: 200 }),
    ]
    const { items } = detectRecurring(withGap, { now: NOW })
    expect(items[0].cadence).toBe('monthly')
  })

  it('groups descriptions that differ only by digits', () => {
    const { items } = detectRecurring(
      [
        txn({ description: 'סופר יוחננוף 11', transactionDate: '2026-05-05T00:00:00.000Z' }),
        txn({ description: 'סופר יוחננוף 22', transactionDate: '2026-06-05T00:00:00.000Z' }),
        txn({ description: 'סופר יוחננוף 33', transactionDate: '2026-07-05T00:00:00.000Z' }),
      ],
      { now: NOW }
    )
    expect(items).toHaveLength(1)
    expect(items[0].occurrences).toBe(3)
  })

  it('excludes income and internal movement', () => {
    const { items } = detectRecurring(
      [
        ...monthlySeries('משכורת', [12000, 12000, 12000]).map((t) => ({ ...t, direction: 'income' as const })),
        ...monthlySeries('כרטיס אשראי', [5000, 5000, 5000], 'כרטיס אשראי'),
      ],
      { now: NOW }
    )
    expect(items).toHaveLength(0)
  })

  it('sums only monthly charges into the fixed monthly total', () => {
    const { monthlyFixedTotal } = detectRecurring(
      [
        ...monthlySeries('נטפליקס', [50, 50, 50]),
        txn({ description: 'רהיטים', transactionDate: '2026-03-01T00:00:00.000Z' }),
        txn({ description: 'רהיטים', transactionDate: '2026-03-03T00:00:00.000Z' }),
        txn({ description: 'רהיטים', transactionDate: '2026-03-05T00:00:00.000Z' }),
      ],
      { now: NOW }
    )
    expect(monthlyFixedTotal).toBe(50)
  })
})

describe('computeInsights', () => {
  const emptyRecurring = { items: [], monthlyFixedTotal: 0 }

  function baseTrend() {
    return [
      { month: '2026-05', income: 10000, expense: 8000, net: 2000 },
      { month: '2026-06', income: 10000, expense: 8000, net: 2000 },
      { month: '2026-07', income: 10000, expense: 8000, net: 2000 },
      { month: '2026-08', income: 10000, expense: 9000, net: 1000 },
    ]
  }

  it('reports overspend when a category exceeds its average by 25% and ₪200', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: {
        total: 900,
        items: [
          { category: 'אוכל בחוץ', total: 900, count: 9, share: 100, trailingAvg: 400, deltaAbs: 500, deltaPct: 125 },
        ],
      },
      recurring: emptyRecurring,
      now: NOW,
    })

    const overspend = insights.find((i) => i.kind === 'overspend')!
    expect(overspend).toBeDefined()
    expect(overspend.category).toBe('אוכל בחוץ')
    expect(overspend.amount).toBe(500)
  })

  it('does not report overspend when the shekel delta is below the floor', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: {
        total: 150,
        items: [
          { category: 'אוכל בחוץ', total: 150, count: 3, share: 100, trailingAvg: 100, deltaAbs: 50, deltaPct: 50 },
        ],
      },
      recurring: emptyRecurring,
      now: NOW,
    })
    expect(insights.find((i) => i.kind === 'overspend')).toBeUndefined()
  })

  it('never reports overspend for uncategorized money', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: {
        total: 5000,
        items: [
          { category: 'ללא סיווג', total: 5000, count: 4, share: 100, trailingAvg: 1000, deltaAbs: 4000, deltaPct: 400 },
        ],
      },
      recurring: emptyRecurring,
      now: NOW,
    })
    expect(insights.find((i) => i.kind === 'overspend')).toBeUndefined()
  })

  it('computes the savings rate and its direction of change', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: { total: 0, items: [] },
      recurring: emptyRecurring,
      now: NOW,
    })
    const rate = insights.find((i) => i.kind === 'savings_rate')!
    expect(rate.title).toContain('10%')
    expect(rate.title).toContain('ירידה')
  })

  it('expresses committed income as a share of average income', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: { total: 0, items: [] },
      recurring: { items: [], monthlyFixedTotal: 6000 },
      now: NOW,
    })
    const load = insights.find((i) => i.kind === 'commitment_load')!
    expect(load.title).toContain('60%')
    expect(load.severity).toBe('warn')
  })

  it('offers savings potential only for discretionary commitments', () => {
    const recurring = {
      monthlyFixedTotal: 5200,
      items: [
        {
          label: 'נטפליקס',
          category: 'מנויים',
          occurrences: 6,
          avgAmount: 50,
          lastAmount: 50,
          lastDate: '2026-08-05T00:00:00.000Z',
          firstDate: '2026-03-05T00:00:00.000Z',
          cadence: 'monthly' as const,
          annualizedCost: 600,
          increasedPct: null,
        },
        {
          label: 'משכנתא',
          category: 'משכנתא',
          occurrences: 6,
          avgAmount: 5000,
          lastAmount: 5000,
          lastDate: '2026-08-05T00:00:00.000Z',
          firstDate: '2026-03-05T00:00:00.000Z',
          cadence: 'monthly' as const,
          annualizedCost: 60000,
          increasedPct: null,
        },
      ],
    }

    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: { total: 0, items: [] },
      recurring,
      now: NOW,
    })

    const potential = insights.find((i) => i.kind === 'savings_potential')!
    expect(potential.amount).toBe(600)
    expect(potential.body).toContain('נטפליקס')
    expect(potential.body).not.toContain('משכנתא')
  })

  it('flags a recurring charge first seen within the last 60 days as new', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: { total: 0, items: [] },
      recurring: {
        monthlyFixedTotal: 90,
        items: [
          {
            label: 'שירות חדש',
            category: 'מנויים',
            occurrences: 3,
            avgAmount: 90,
            lastAmount: 90,
            lastDate: '2026-08-10T00:00:00.000Z',
            firstDate: '2026-07-10T00:00:00.000Z',
            cadence: 'monthly',
            annualizedCost: 1080,
            increasedPct: null,
          },
        ],
      },
      now: NOW,
    })
    expect(insights.find((i) => i.kind === 'new_recurring')).toBeDefined()
  })

  it('orders opportunities before warnings before information', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: {
        total: 900,
        items: [
          { category: 'אוכל בחוץ', total: 900, count: 9, share: 100, trailingAvg: 400, deltaAbs: 500, deltaPct: 125 },
        ],
      },
      recurring: {
        monthlyFixedTotal: 50,
        items: [
          {
            label: 'נטפליקס',
            category: 'מנויים',
            occurrences: 6,
            avgAmount: 50,
            lastAmount: 50,
            lastDate: '2026-08-05T00:00:00.000Z',
            firstDate: '2025-03-05T00:00:00.000Z',
            cadence: 'monthly',
            annualizedCost: 600,
            increasedPct: null,
          },
        ],
      },
      now: NOW,
    })

    const severities = insights.map((i) => i.severity)
    expect(severities[0]).toBe('opportunity')
    expect(severities.indexOf('warn')).toBeLessThan(severities.lastIndexOf('info'))
  })

  it('every insight carries a quantified figure', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: {
        total: 900,
        items: [
          { category: 'אוכל בחוץ', total: 900, count: 9, share: 100, trailingAvg: 400, deltaAbs: 500, deltaPct: 125 },
        ],
      },
      recurring: { items: [], monthlyFixedTotal: 3000 },
      now: NOW,
    })

    expect(insights.length).toBeGreaterThan(0)
    for (const insight of insights) {
      expect(`${insight.title} ${insight.body}`).toMatch(/\d/)
    }
  })

  it('never returns data-quality kinds — those belong to the coverage query', () => {
    const insights = computeInsights({
      month: '2026-08',
      trend: baseTrend(),
      breakdown: {
        total: 5000,
        items: [
          { category: 'ללא סיווג', total: 5000, count: 4, share: 100, trailingAvg: 0, deltaAbs: 5000, deltaPct: null },
        ],
      },
      recurring: emptyRecurring,
      now: NOW,
    })
    expect(insights.map((i) => i.kind)).not.toContain('coverage')
    expect(insights.map((i) => i.kind)).not.toContain('blind_spot')
  })
})
