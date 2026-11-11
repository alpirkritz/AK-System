import { describe, test, expect } from 'vitest'
import { sanitizePii, deduplicateAggregateCharges, type Transaction } from './cfo-pii-sanitizer'

describe('cfo-pii-sanitizer', () => {
  describe('sanitizePii', () => {
    test('redacts Israeli ID (9 digits)', () => {
      const text = 'תעודת זהות: 123456789'
      const result = sanitizePii(text)
      expect(result.sanitized).toContain('[REDACTED]')
      expect(result.sanitized).not.toContain('123456789')
      expect(result.breakdown.israeliIds).toBe(1)
      expect(result.redactedCount).toBe(1)
    })

    test('redacts Israeli ID with separators', () => {
      const text = 'ת.ז. 123-45-6789'
      const result = sanitizePii(text)
      expect(result.sanitized).toContain('[REDACTED]')
      expect(result.breakdown.israeliIds).toBe(1)
    })

    test('redacts valid credit card number (Luhn check)', () => {
      // Valid Luhn: 4532015112830366 (test Visa)
      const text = 'Card: 4532 0151 1283 0366'
      const result = sanitizePii(text)
      expect(result.sanitized).toContain('[REDACTED]')
      expect(result.breakdown.creditCards).toBe(1)
    })

    test('does NOT redact invalid credit card number (fails Luhn)', () => {
      const text = 'Card: 1234 5678 9012 3456' // invalid Luhn
      const result = sanitizePii(text)
      expect(result.sanitized).toBe(text) // unchanged
      expect(result.breakdown.creditCards).toBe(0)
    })

    test('redacts Israeli IBAN', () => {
      const text = 'IBAN: IL620108000000099999999'
      const result = sanitizePii(text)
      expect(result.sanitized).toContain('[REDACTED]')
      expect(result.breakdown.ibans).toBe(1)
    })

    test('redacts bank account number after keyword', () => {
      const text = 'חשבון: 123456789'
      const result = sanitizePii(text)
      expect(result.sanitized).toContain('[REDACTED]')
      expect(result.breakdown.accountNumbers).toBe(1)
    })

    test('does NOT redact standalone numbers without context', () => {
      const text = 'Amount: 500 ₪ on 20231015'
      const result = sanitizePii(text)
      expect(result.sanitized).toBe(text) // unchanged
      expect(result.redactedCount).toBe(0)
    })

    test('redacts multiple PII types in one text', () => {
      const text = `
        ת.ז. 123456789
        IBAN: IL620108000000099999999
        כרטיס: 4532 0151 1283 0366
        חשבון: 987654321
      `
      const result = sanitizePii(text)
      expect(result.redactedCount).toBe(4)
      expect(result.breakdown.israeliIds).toBe(1)
      expect(result.breakdown.ibans).toBe(1)
      expect(result.breakdown.creditCards).toBe(1)
      expect(result.breakdown.accountNumbers).toBe(1)
    })
  })

  describe('deduplicateAggregateCharges', () => {
    test('removes aggregate charge when card transactions match', () => {
      const txns: Transaction[] = [
        {
          id: 'bank-1',
          amount: 1000,
          description: 'חיוב כרטיס אשראי',
          transactionDate: '2026-10-15',
          source: 'hapoalim',
          direction: 'expense',
        },
        {
          id: 'card-1',
          amount: 500,
          description: 'סופר',
          transactionDate: '2026-10-10',
          source: 'visaCal',
          direction: 'expense',
        },
        {
          id: 'card-2',
          amount: 500,
          description: 'דלק',
          transactionDate: '2026-10-12',
          source: 'visaCal',
          direction: 'expense',
        },
      ]

      const result = deduplicateAggregateCharges(txns)
      expect(result.removedAggregateIds).toContain('bank-1')
      expect(result.transactions).toHaveLength(2) // only card-1 and card-2
      expect(result.dedupLog).toHaveLength(1)
      expect(result.dedupLog[0]).toContain('1000')
    })

    test('keeps aggregate charge when sum does NOT match (outside 5% tolerance)', () => {
      const txns: Transaction[] = [
        {
          id: 'bank-1',
          amount: 1000,
          description: 'חיוב כרטיס אשראי',
          transactionDate: '2026-10-15',
          source: 'hapoalim',
          direction: 'expense',
        },
        {
          id: 'card-1',
          amount: 300,
          description: 'סופר',
          transactionDate: '2026-10-10',
          source: 'visaCal',
          direction: 'expense',
        },
      ]

      const result = deduplicateAggregateCharges(txns)
      expect(result.removedAggregateIds).toHaveLength(0)
      expect(result.transactions).toHaveLength(2) // both kept
    })

    test('keeps aggregate charge when no card transactions in same month', () => {
      const txns: Transaction[] = [
        {
          id: 'bank-1',
          amount: 1000,
          description: 'חיוב כרטיס אשראי',
          transactionDate: '2026-10-15',
          source: 'hapoalim',
          direction: 'expense',
        },
        {
          id: 'card-1',
          amount: 1000,
          description: 'סופר',
          transactionDate: '2026-09-10', // different month
          source: 'visaCal',
          direction: 'expense',
        },
      ]

      const result = deduplicateAggregateCharges(txns)
      expect(result.removedAggregateIds).toHaveLength(0)
      expect(result.transactions).toHaveLength(2)
    })

    test('handles empty input', () => {
      const result = deduplicateAggregateCharges([])
      expect(result.transactions).toHaveLength(0)
      expect(result.removedAggregateIds).toHaveLength(0)
    })
  })
})
