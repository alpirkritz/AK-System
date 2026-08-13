import { describe, it, expect } from 'vitest'
import { fmt, fmtShort } from './format'

describe('finance fmt', () => {
  it('formats ISO currency codes', () => {
    expect(fmt(100, 'ILS')).toContain('100')
    expect(fmt(100, 'USD')).toContain('100')
  })

  it('does not throw on bank-scraper symbol currencies', () => {
    expect(() => fmt(8100, '₪')).not.toThrow()
    expect(() => fmt(50, '$')).not.toThrow()
    expect(() => fmt(12, '€')).not.toThrow()
    expect(fmt(8100, '₪')).toContain('8')
  })

  it('fmtShort tolerates symbol currencies', () => {
    expect(() => fmtShort(5000, '₪')).not.toThrow()
  })
})
