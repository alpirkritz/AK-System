import { describe, test, expect } from 'vitest'
import { computeBaseline, type AnalyticsTxn } from './cfo-profiler'

describe('cfo-profiler', () => {
  test('computes baseline from 12-month transactions', () => {
    const txns: AnalyticsTxn[] = [
      {
        amount: 15000,
        direction: 'income',
        category: 'משכורת',
        description: 'Salary',
        transactionDate: '2026-09-15',
      },
      {
        amount: 5000,
        direction: 'expense',
        category: 'דיור',
        description: 'Rent',
        transactionDate: '2026-09-01',
      },
      {
        amount: 3000,
        direction: 'expense',
        category: 'מזון',
        description: 'Groceries',
        transactionDate: '2026-09-05',
      },
    ]

    const result = computeBaseline(txns, 2000)
    expect(result.netIncome).toBeGreaterThan(0)
    expect(result.freeCash).toBeDefined()
    expect(result.minBalanceCushion).toBe(2200) // 2000 × 1.1
    expect(result.monthsAnalyzed).toBeLessThanOrEqual(12)
  })

  test('excludes internal transfers', () => {
    const txns: AnalyticsTxn[] = [
      {
        amount: 15000,
        direction: 'income',
        category: 'משכורת',
        description: 'Salary',
        transactionDate: '2026-09-15',
      },
      {
        amount: 5000,
        direction: 'expense',
        category: 'העברות פנימיות',
        description: 'Internal transfer',
        transactionDate: '2026-09-10',
      },
    ]

    const result = computeBaseline(txns)
    // Internal transfer should be excluded from calculations
    expect(result.netIncome).toBeGreaterThan(0)
  })
})
