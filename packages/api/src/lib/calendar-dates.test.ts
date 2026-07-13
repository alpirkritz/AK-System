import { describe, expect, it } from 'vitest'
import { localDateRangeToUtc, localMidnightToUtc, localTodayIso } from './calendar-dates'

const TZ = 'Asia/Jerusalem'

describe('localTodayIso', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(localTodayIso(TZ)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('localMidnightToUtc', () => {
  it('maps Israel midnight to previous evening UTC in summer', () => {
    const utc = localMidnightToUtc('2026-07-09', TZ)
    expect(utc.toISOString()).toBe('2026-07-08T21:00:00.000Z')
  })

  // Invariant that guards the small-ICU hour="24" bug: the returned instant must
  // format back to the SAME date at 00:00 local — never the previous day.
  it('round-trips to the same local date at midnight (ICU-independent)', () => {
    for (const date of ['2026-01-15', '2026-07-12', '2026-03-27', '2026-10-25']) {
      const utc = localMidnightToUtc(date, TZ)
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(utc)
      const localTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(utc)
      expect(localDate).toBe(date)
      expect(['00:00', '24:00']).toContain(localTime)
    }
  })
})

describe('localDateRangeToUtc', () => {
  it('covers full local day for single-day query', () => {
    const { timeMin, timeMax } = localDateRangeToUtc('2026-07-09', '2026-07-09', TZ)
    expect(timeMin.toISOString()).toBe('2026-07-08T21:00:00.000Z')
    expect(timeMax.toISOString()).toBe('2026-07-09T21:00:00.000Z')
  })
})
