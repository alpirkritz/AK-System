import { describe, test, expect } from 'vitest'
import {
  detectAnomalies,
  validateSweep,
  generateAdversarialChecklist,
  type AnalyticsTxn,
  type BaselineProfile,
} from './cfo-monthly-review'

describe('cfo-monthly-review', () => {
  describe('detectAnomalies', () => {
    test('flags category exceeding rolling avg by > 15%', () => {
      const txns: AnalyticsTxn[] = [
        // Historical months (avg 1000/month)
        ...Array.from({ length: 11 }, (_, i) => ({
          amount: 1000,
          direction: 'expense' as const,
          category: 'מזון',
          description: 'Groceries',
          transactionDate: `2026-0${i + 1}-15`,
        })),
        // Current month (spike to 1500)
        {
          amount: 1500,
          direction: 'expense' as const,
          category: 'מזון',
          description: 'Groceries',
          transactionDate: '2026-10-15',
        },
      ]

      const anomalies = detectAnomalies(txns, '2026-10')
      expect(anomalies).toHaveLength(1)
      expect(anomalies[0].category).toBe('מזון')
      expect(anomalies[0].excessPct).toBeGreaterThan(0.15)
    })

    test('ignores small categories < 100', () => {
      const txns: AnalyticsTxn[] = [
        {
          amount: 50,
          direction: 'expense' as const,
          category: 'אחר',
          description: 'Small',
          transactionDate: '2026-10-15',
        },
      ]

      const anomalies = detectAnomalies(txns, '2026-10')
      expect(anomalies).toHaveLength(0)
    })

    test('sorts anomalies by excess amount descending', () => {
      const txns: AnalyticsTxn[] = [
        // Category A: avg 100, current 200 (+100)
        { amount: 100, direction: 'expense' as const, category: 'A', description: 'A', transactionDate: '2026-09-15' },
        { amount: 200, direction: 'expense' as const, category: 'A', description: 'A', transactionDate: '2026-10-15' },
        // Category B: avg 500, current 1000 (+500)
        { amount: 500, direction: 'expense' as const, category: 'B', description: 'B', transactionDate: '2026-09-15' },
        { amount: 1000, direction: 'expense' as const, category: 'B', description: 'B', transactionDate: '2026-10-15' },
      ]

      const anomalies = detectAnomalies(txns, '2026-10')
      expect(anomalies[0].category).toBe('B') // bigger excess first
    })
  })

  describe('validateSweep', () => {
    test('returns OK when balance slightly above threshold', () => {
      const result = validateSweep(20000, 18000) // 2k excess (< 50% of threshold)
      expect(result.status).toBe('OK')
    })

    test('warns when large excess sits idle', () => {
      const result = validateSweep(30000, 18000) // 12k excess (> 50% of threshold)
      expect(result.status).toBe('WARN')
      expect(result.message).toContain('לא פרודוקטיבי')
    })

    test('flags critical when below Layer 1', () => {
      const result = validateSweep(15000, 18000) // 3k below
      expect(result.status).toBe('CRITICAL')
      expect(result.message).toContain('מתחת')
    })
  })

  describe('generateAdversarialChecklist', () => {
    const mockProfile: BaselineProfile = {
      fixed: 10000,
      variable: 5000,
      yearlyAmortized: 2000,
      netIncome: 20000,
      freeCash: 3000,
      minBalanceCushion: 15000,
      monthsAnalyzed: 12,
    }

    test('includes debt payoff action when debts exist', () => {
      const { items } = generateAdversarialChecklist(mockProfile, 24, 0)
      const debtItem = items.find((i) => i.id === 'debt-payoff')
      expect(debtItem).toBeDefined()
      expect(debtItem!.priority).toBe(1)
    })

    test('includes pension fee action when drag > 10k', () => {
      const { items } = generateAdversarialChecklist(mockProfile, null, 50000)
      const pensionItem = items.find((i) => i.id === 'pension-fees')
      expect(pensionItem).toBeDefined()
      expect(pensionItem!.impactIls).toBeGreaterThan(0)
    })

    test('includes emergency fund action when cushion insufficient', () => {
      const { items } = generateAdversarialChecklist(mockProfile, null, 0)
      const emergencyItem = items.find((i) => i.id === 'emergency-fund')
      expect(emergencyItem).toBeDefined()
    })

    test('returns stress test scenarios', () => {
      const { stressTests } = generateAdversarialChecklist(mockProfile, null, 0)
      expect(stressTests.length).toBeGreaterThan(0)
      expect(stressTests[0]).toContain('מה אם')
    })

    test('sorts action items by impact', () => {
      const { items } = generateAdversarialChecklist(mockProfile, 24, 50000)
      if (items.length > 1) {
        expect(items[0].impactIls).toBeGreaterThanOrEqual(items[1].impactIls)
      }
    })
  })
})
