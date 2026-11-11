import { describe, expect, it } from 'vitest'
import { pairSpans } from './spans'

describe('pairSpans', () => {
  it('pairs two adjacent half blocks', () => {
    expect(pairSpans([false, true, true, false])).toEqual([2, 1, 1, 2])
  })
  it('gives a lone half block the full row', () => {
    expect(pairSpans([true, false, true])).toEqual([2, 2, 2])
  })
  it('pairs greedily from the start in a run of halves', () => {
    expect(pairSpans([true, true, true])).toEqual([1, 1, 2])
  })
  it('handles empty input', () => {
    expect(pairSpans([])).toEqual([])
  })
})
