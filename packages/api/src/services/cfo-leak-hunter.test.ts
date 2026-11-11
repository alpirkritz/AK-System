import { describe, test, expect } from 'vitest'
import { analyzeLeaks, generateNegotiationLetter, type RecurringItem } from './cfo-leak-hunter'

describe('cfo-leak-hunter', () => {
  describe('analyzeLeaks', () => {
    test('flags price creep as RENEGOTIATE', () => {
      const items: RecurringItem[] = [
        {
          label: 'Netflix',
          category: 'מינויים',
          occurrences: 12,
          avgAmount: 50,
          lastAmount: 60,
          lastDate: new Date().toISOString().substring(0, 10),
          cadence: 'monthly',
          annualizedCost: 720,
          increasedPct: 0.20, // 20% increase
          firstDate: '2025-01-01',
        },
      ]

      const result = analyzeLeaks(items)
      expect(result.leaks).toHaveLength(1)
      expect(result.leaks[0].action).toBe('RENEGOTIATE')
      expect(result.leaks[0].reason).toContain('עליית מחיר')
      expect(result.leaks[0].potentialSavings).toBeGreaterThan(0)
    })

    test('flags inactive subscriptions as CANCEL', () => {
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 120) // 120 days ago

      const items: RecurringItem[] = [
        {
          label: 'Gym membership',
          category: 'ספורט',
          occurrences: 6,
          avgAmount: 200,
          lastAmount: 200,
          lastDate: oldDate.toISOString().substring(0, 10),
          cadence: 'monthly',
          annualizedCost: 2400,
          increasedPct: null,
          firstDate: '2025-01-01',
        },
      ]

      const result = analyzeLeaks(items)
      expect(result.leaks[0].action).toBe('CANCEL')
      expect(result.leaks[0].reason).toContain('לא נעשה שימוש')
    })

    test('flags bank fees as RENEGOTIATE', () => {
      const items: RecurringItem[] = [
        {
          label: 'דמי ניהול חשבון',
          category: 'עמלות',
          occurrences: 12,
          avgAmount: 15,
          lastAmount: 15,
          lastDate: new Date().toISOString().substring(0, 10),
          cadence: 'monthly',
          annualizedCost: 180,
          increasedPct: null,
          firstDate: '2025-01-01',
        },
      ]

      const result = analyzeLeaks(items)
      expect(result.leaks[0].action).toBe('RENEGOTIATE')
      expect(result.leaks[0].reason).toContain('עמלת בנק')
      expect(result.totalBankFees).toBe(180)
    })

    test('keeps regular charges as KEEP', () => {
      const items: RecurringItem[] = [
        {
          label: 'Electric bill',
          category: 'חשמל',
          occurrences: 12,
          avgAmount: 300,
          lastAmount: 300,
          lastDate: new Date().toISOString().substring(0, 10),
          cadence: 'monthly',
          annualizedCost: 3600,
          increasedPct: 0.02, // 2% increase (below threshold)
          firstDate: '2025-01-01',
        },
      ]

      const result = analyzeLeaks(items)
      expect(result.leaks[0].action).toBe('KEEP')
    })

    test('computes total potential savings', () => {
      const items: RecurringItem[] = [
        {
          label: 'Subscription A',
          category: 'מינויים',
          occurrences: 12,
          avgAmount: 50,
          lastAmount: 60,
          lastDate: new Date().toISOString().substring(0, 10),
          cadence: 'monthly',
          annualizedCost: 720,
          increasedPct: 0.20,
          firstDate: '2025-01-01',
        },
        {
          label: 'Subscription B',
          category: 'מינויים',
          occurrences: 6,
          avgAmount: 100,
          lastAmount: 100,
          lastDate: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
          cadence: 'monthly',
          annualizedCost: 1200,
          increasedPct: null,
          firstDate: '2025-01-01',
        },
      ]

      const result = analyzeLeaks(items)
      expect(result.totalPotentialSavings).toBeGreaterThan(0)
      expect(result.summary).toContain('חיסכון פוטנציאלי')
    })
  })

  describe('generateNegotiationLetter', () => {
    test('generates Hebrew letter with leak details', () => {
      const leak = {
        id: 'leak-netflix',
        label: 'Netflix',
        category: 'מינויים',
        occurrences: 12,
        avgAmount: 50,
        lastAmount: 60,
        lastDate: new Date().toISOString().substring(0, 10),
        firstDate: '2025-01-01',
        increasedPct: 0.20,
        action: 'RENEGOTIATE' as const,
        reason: 'Price increase',
        annualizedCost: 720,
        potentialSavings: 144,
      }

      const letter = generateNegotiationLetter(leak)
      expect(letter).toContain('שלום')
      expect(letter).toContain('Netflix')
      expect(letter).toContain('60')
      expect(letter).toContain('בברכה')
    })
  })
})
