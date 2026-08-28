import { describe, it, expect } from 'vitest'
import {
  fuzzyTxnMatch,
  normalizeTxnDateForDedupe,
  normalizeTxnDescriptionForDedupe,
  transactionDedupeKey,
} from './bank-transaction-dedupe'

describe('bank-transaction-dedupe', () => {
  it('normalizeTxnDateForDedupe uses calendar day only', () => {
    expect(normalizeTxnDateForDedupe('2026-08-14T06:40:12.000Z')).toBe('2026-08-14')
    expect(normalizeTxnDateForDedupe('2026-08-14T06:40:14.000Z')).toBe('2026-08-14')
  })

  it('transactionDedupeKey ignores time-of-day differences on the same day', () => {
    const base = { chargedAmount: -277.8, description: 'דקאתלון' }
    const a = transactionDedupeKey('4018', { ...base, date: '2026-08-14T06:40:12.000Z' })
    const b = transactionDedupeKey('4018', { ...base, date: '2026-08-14T06:40:14.000Z' })
    expect(a).toBe(b)
  })

  it('fuzzyTxnMatch matches same purchase on same day with different timestamps', () => {
    expect(
      fuzzyTxnMatch(
        { description: 'דקאתלון', amount: '277.8', transactionDate: '2026-08-14T06:40:12.000Z' },
        { description: 'דקאתלון', amount: 277.8, date: '2026-08-14T06:40:14.000Z' },
      ),
    ).toBe(true)
  })

  it('fuzzyTxnMatch does not merge same merchant/day when amounts differ', () => {
    const existing = {
      description: 'סופר פארם',
      amount: '10',
      transactionDate: '2026-08-14T10:00:00.000Z',
    }
    expect(
      fuzzyTxnMatch(existing, { description: 'סופר פארם', amount: 5, date: '2026-08-14T18:00:00.000Z' }),
    ).toBe(false)
  })

  it('transactionDedupeKey differs for same merchant/day with different amounts', () => {
    const base = { date: '2026-08-14T12:00:00.000Z', description: 'סופר פארם' }
    expect(transactionDedupeKey('4018', { ...base, chargedAmount: -10 })).not.toBe(
      transactionDedupeKey('4018', { ...base, chargedAmount: -5 }),
    )
  })

  it('normalizeTxnDescriptionForDedupe collapses whitespace and case', () => {
    expect(normalizeTxnDescriptionForDedupe('  Foo   Bar  ')).toBe('foo bar')
  })
})
