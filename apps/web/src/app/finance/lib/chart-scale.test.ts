import { describe, it, expect } from 'vitest'
import { niceMax, ticks, scaleLinear, describeArc, poolSmallSlices } from './chart-scale'

describe('niceMax', () => {
  it('rounds up to a readable 1/2/5 bound', () => {
    expect(niceMax(0.9)).toBe(1)
    expect(niceMax(1200)).toBe(2000)
    expect(niceMax(4300)).toBe(5000)
    expect(niceMax(6100)).toBe(10000)
  })

  it('never returns zero, so a scale cannot divide by zero', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(-50)).toBe(1)
    expect(niceMax(Number.NaN)).toBe(1)
  })
})

describe('ticks', () => {
  it('returns count + 1 evenly spaced values starting at zero', () => {
    expect(ticks(1000, 4)).toEqual([0, 250, 500, 750, 1000])
  })
})

describe('scaleLinear', () => {
  it('maps a value proportionally into the range', () => {
    expect(scaleLinear(50, 100, 200)).toBe(100)
  })

  it('clamps negatives to zero rather than drawing below the axis', () => {
    expect(scaleLinear(-10, 100, 200)).toBe(0)
  })

  it('returns zero for an empty domain', () => {
    expect(scaleLinear(10, 0, 200)).toBe(0)
  })
})

describe('describeArc', () => {
  it('produces a closed path with both arcs', () => {
    const path = describeArc(100, 100, 90, 60, 0, 90)
    expect(path.startsWith('M ')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    expect(path.match(/A /g)).toHaveLength(2)
  })

  it('sets the large-arc flag past a half turn', () => {
    expect(describeArc(100, 100, 90, 60, 0, 200)).toContain('0 1 1')
    expect(describeArc(100, 100, 90, 60, 0, 90)).toContain('0 0 1')
  })

  it('keeps a full circle just under 360° so it stays drawable', () => {
    const path = describeArc(100, 100, 90, 60, 0, 360)
    expect(path).not.toContain('NaN')
    expect(path.startsWith('M ')).toBe(true)
  })
})

describe('poolSmallSlices', () => {
  it('pools everything below the threshold share', () => {
    const { visible, pooled, pooledTotal } = poolSmallSlices(
      [{ total: 90 }, { total: 8 }, { total: 2 }],
      5
    )
    expect(visible).toHaveLength(2)
    expect(pooled).toHaveLength(1)
    expect(pooledTotal).toBe(2)
  })

  it('pools nothing when every slice clears the threshold', () => {
    const { pooled } = poolSmallSlices([{ total: 50 }, { total: 50 }], 5)
    expect(pooled).toHaveLength(0)
  })

  it('handles an all-zero input without dividing by zero', () => {
    const { visible, pooled } = poolSmallSlices([{ total: 0 }], 3)
    expect(visible).toHaveLength(1)
    expect(pooled).toHaveLength(0)
  })
})
