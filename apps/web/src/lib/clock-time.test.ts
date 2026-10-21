import { describe, expect, it } from 'vitest'
import { clockFromTime, formatTimeRange } from './clock-time'

describe('clockFromTime', () => {
  it('keeps plain HH:MM', () => {
    expect(clockFromTime('09:30')).toBe('09:30')
    expect(clockFromTime('9:30')).toBe('09:30')
  })

  it('reduces an ISO timestamp (what calendar sync stores) to local HH:MM', () => {
    const iso = '2026-11-03T21:00:00+02:00'
    const d = new Date(iso)
    const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    expect(clockFromTime(iso)).toBe(expected)
  })

  it('returns null for empty values', () => {
    expect(clockFromTime(null)).toBeNull()
    expect(clockFromTime('')).toBeNull()
  })
})

describe('formatTimeRange', () => {
  it('joins start and end with an en dash', () => {
    expect(formatTimeRange('10:30', '11:00')).toBe('10:30–11:00')
  })
  it('falls back to the start alone', () => {
    expect(formatTimeRange('10:30', null)).toBe('10:30')
  })
})
