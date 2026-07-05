import { describe, expect, it } from 'vitest'
import { isFreeBusyPlaceholderTitle } from './calendar-filters'

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
