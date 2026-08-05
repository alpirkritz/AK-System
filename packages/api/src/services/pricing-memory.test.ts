import { describe, it, expect } from 'vitest'
import { resolveUnitPrice, pickLatestPerItem, type HistoryRow } from './pricing-memory'

describe('resolveUnitPrice precedence', () => {
  const catalogDefault = { unitPrice: 1000, currency: 'ILS' }

  it('prefers a pinned client rate over history and catalog', () => {
    const resolved = resolveUnitPrice({
      pinned: { unitPrice: 1500, currency: 'ILS' },
      lastIssued: {
        unitPrice: 1200,
        currency: 'ILS',
        lastUsedAt: '2026-04-01',
        lastDocumentId: 'sd1',
      },
      catalogDefault,
    })
    expect(resolved.unitPrice).toBe(1500)
    expect(resolved.source).toBe('pinned')
  })

  it('falls back to the last price charged to this client', () => {
    const resolved = resolveUnitPrice({
      pinned: null,
      lastIssued: {
        unitPrice: 1200,
        currency: 'ILS',
        lastUsedAt: '2026-04-01',
        lastDocumentId: 'sd1',
      },
      catalogDefault,
    })
    expect(resolved.unitPrice).toBe(1200)
    expect(resolved.source).toBe('history')
    expect(resolved.lastUsedAt).toBe('2026-04-01')
    expect(resolved.lastDocumentId).toBe('sd1')
  })

  it('falls back to the catalog default for a new client', () => {
    const resolved = resolveUnitPrice({ pinned: null, lastIssued: null, catalogDefault })
    expect(resolved.unitPrice).toBe(1000)
    expect(resolved.source).toBe('catalog')
    expect(resolved.currencyMismatch).toBe(false)
  })

  it('flags a currency mismatch instead of converting silently', () => {
    const resolved = resolveUnitPrice({
      pinned: null,
      lastIssued: null,
      catalogDefault: { unitPrice: 1000, currency: 'ILS' },
      documentCurrency: 'USD',
    })
    expect(resolved.currencyMismatch).toBe(true)
    expect(resolved.unitPrice).toBe(1000)
  })
})

describe('pickLatestPerItem', () => {
  it('keeps the most recent issued price per catalog item', () => {
    const rows: HistoryRow[] = [
      { serviceItemId: 'si1', unitPrice: '900', currency: 'ILS', issueDate: '2026-01-10', documentId: 'a' },
      { serviceItemId: 'si1', unitPrice: '1100', currency: 'ILS', issueDate: '2026-05-10', documentId: 'b' },
      { serviceItemId: 'si2', unitPrice: '300', currency: 'USD', issueDate: '2026-03-01', documentId: 'c' },
    ]
    const latest = pickLatestPerItem(rows)
    expect(latest.si1.unitPrice).toBe(1100)
    expect(latest.si1.lastDocumentId).toBe('b')
    expect(latest.si2.currency).toBe('USD')
  })

  it('ignores free-text lines that are not linked to the catalog', () => {
    const latest = pickLatestPerItem([
      { serviceItemId: null, unitPrice: '500', currency: 'ILS', issueDate: '2026-05-01', documentId: 'a' },
    ])
    expect(Object.keys(latest)).toHaveLength(0)
  })
})
