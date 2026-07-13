import { describe, expect, it } from 'vitest'
import { isExcludedFromCalendarOptimizer, isFreeBusyPlaceholderTitle } from './calendar-filters'

describe('isFreeBusyPlaceholderTitle', () => {
  it('matches Hebrew placeholders', () => {
    expect(isFreeBusyPlaceholderTitle('פנוי')).toBe(true)
    expect(isFreeBusyPlaceholderTitle('לא פנוי')).toBe(true)
  })

  it('matches English placeholders case-insensitively', () => {
    expect(isFreeBusyPlaceholderTitle('Busy')).toBe(true)
    expect(isFreeBusyPlaceholderTitle('busy')).toBe(true)
    expect(isFreeBusyPlaceholderTitle('  FREE  ')).toBe(true)
    expect(isFreeBusyPlaceholderTitle('Tentative')).toBe(true)
    expect(isFreeBusyPlaceholderTitle('tentative')).toBe(true)
  })

  it('does not match real meetings', () => {
    expect(isFreeBusyPlaceholderTitle('Sync with team')).toBe(false)
    expect(isFreeBusyPlaceholderTitle('1:1 with Alpir')).toBe(false)
  })
})

describe('isExcludedFromCalendarOptimizer', () => {
  it('excludes all-day events', () => {
    expect(
      isExcludedFromCalendarOptimizer({
        start: '2026-07-12',
        end: '2026-07-13',
        isAllDay: true,
      }),
    ).toBe(true)
  })

  it('excludes timed events of 8 hours or more', () => {
    expect(
      isExcludedFromCalendarOptimizer({
        start: '2026-07-12T10:00:00+03:00',
        end: '2026-07-12T18:00:00+03:00',
        isAllDay: false,
      }),
    ).toBe(true)
  })

  it('keeps timed events under 8 hours', () => {
    expect(
      isExcludedFromCalendarOptimizer({
        start: '2026-07-12T10:15:00+03:00',
        end: '2026-07-12T12:30:00+03:00',
        isAllDay: false,
      }),
    ).toBe(false)
  })
})
