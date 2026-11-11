import { describe, expect, it } from 'vitest'
import {
  TRAY_RECONCILE_GRACE_MS,
  notificationTag,
  staleTrayNotificationIds,
} from './notification-tray'

const NOW = Date.UTC(2026, 9, 6, 17, 0, 0)
const old = (ms = TRAY_RECONCILE_GRACE_MS + 1_000) => NOW - ms

describe('notificationTag', () => {
  it('gives each notification its own tag so pushes do not replace each other', () => {
    expect(notificationTag('abc')).toBe('ak-push-abc')
    expect(notificationTag('def')).toBe('ak-push-def')
    expect(notificationTag('abc')).not.toBe(notificationTag('def'))
  })

  it('falls back to a shared tag when there is no id to key on', () => {
    expect(notificationTag(undefined)).toBe('ak-push')
    expect(notificationTag(null)).toBe('ak-push')
    expect(notificationTag('')).toBe('ak-push')
  })
})

describe('staleTrayNotificationIds', () => {
  it('closes a tray entry whose row left the inbox', () => {
    const stale = staleTrayNotificationIds(
      [{ notificationId: 'archived-elsewhere', timestamp: old() }],
      ['still-in-inbox'],
      NOW,
    )
    expect(stale).toEqual(['archived-elsewhere'])
  })

  it('keeps entries that are still in the inbox', () => {
    const stale = staleTrayNotificationIds(
      [{ notificationId: 'unread', timestamp: old() }],
      ['unread'],
      NOW,
    )
    expect(stale).toEqual([])
  })

  it('spares a fresh arrival that may postdate the inbox snapshot', () => {
    const stale = staleTrayNotificationIds(
      [{ notificationId: 'just-pushed', timestamp: NOW - 5_000 }],
      [],
      NOW,
    )
    expect(stale).toEqual([])
  })

  it('treats the grace boundary as still fresh', () => {
    const atBoundary = staleTrayNotificationIds(
      [{ notificationId: 'edge', timestamp: NOW - TRAY_RECONCILE_GRACE_MS }],
      [],
      NOW,
    )
    expect(atBoundary).toEqual([])

    const pastBoundary = staleTrayNotificationIds(
      [{ notificationId: 'edge', timestamp: NOW - TRAY_RECONCILE_GRACE_MS - 1 }],
      [],
      NOW,
    )
    expect(pastBoundary).toEqual(['edge'])
  })

  it('ignores tray entries that carry no notification id', () => {
    const stale = staleTrayNotificationIds([{ timestamp: old() }], [], NOW)
    expect(stale).toEqual([])
  })

  it('does not repeat an id shown more than once in the tray', () => {
    const stale = staleTrayNotificationIds(
      [
        { notificationId: 'dupe', timestamp: old() },
        { notificationId: 'dupe', timestamp: old(90_000) },
      ],
      [],
      NOW,
    )
    expect(stale).toEqual(['dupe'])
  })

  it('returns nothing for an empty tray', () => {
    expect(staleTrayNotificationIds([], ['a', 'b'], NOW)).toEqual([])
  })
})
