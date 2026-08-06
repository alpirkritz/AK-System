import { describe, it, expect } from 'vitest'
import {
  wasNotificationSentToday,
  wasNotificationSentInSlot,
  NOTIFICATION_TYPES,
} from './notification-preferences'

const TZ = 'Asia/Jerusalem'

describe('wasNotificationSentToday', () => {
  it('returns false when lastSentAt is null', () => {
    expect(wasNotificationSentToday(null, TZ)).toBe(false)
  })

  it('returns false when lastSentAt is undefined', () => {
    expect(wasNotificationSentToday(undefined, TZ)).toBe(false)
  })

  it('returns true when lastSentAt is earlier today in timezone', () => {
    const now = new Date()
    // Stamp a few minutes ago — still same calendar day in TZ for normal runs
    const earlier = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    expect(wasNotificationSentToday(earlier, TZ)).toBe(true)
  })

  it('returns false when lastSentAt was yesterday', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(wasNotificationSentToday(yesterday, TZ)).toBe(false)
  })
})

describe('wasNotificationSentInSlot (regression)', () => {
  it('returns false when slot does not match even if same day', () => {
    const now = new Date()
    const iso = now.toISOString()
    expect(wasNotificationSentInSlot(iso, '00:00', TZ)).toBe(
      wasNotificationSentInSlot(iso, '00:00', TZ),
    )
    // Same-day but wrong slot should be false unless we literally are in 00:00
    const wrongSlot = '23:59'
    const currentSlot = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)
    if (currentSlot !== wrongSlot) {
      expect(wasNotificationSentInSlot(iso, wrongSlot, TZ)).toBe(false)
    }
  })
})

describe('NOTIFICATION_TYPES catalog (regression)', () => {
  it('suggests 03_morning_briefing for the morning briefing (not the calendar optimizer)', () => {
    const morning = NOTIFICATION_TYPES.find((t) => t.id === 'morning_briefing')
    expect(morning?.routable).toBe(true)
    // 06_calendar_optimizer's hardcoded MANDATORY override silently beat the
    // user's customized 03 card — the suggestion must point at 03.
    expect(morning?.suggestedAgentId).toBe('03_morning_briefing')
  })
})
