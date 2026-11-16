import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-caller', () => ({ createServiceCaller: vi.fn() }))

import { hasPositiveCount } from './harness-incremental'
import { morningReminderLines } from './morning-briefing-context'

describe('hasPositiveCount', () => {
  it('finds any positive count in a nested sync result', () => {
    expect(hasPositiveCount({ ok: true, synced: 0, accounts: [{ created: 0, updated: 2 }] })).toBe(true)
    expect(hasPositiveCount({ synced: 0, accounts: [{ created: 0 }] })).toBe(false)
    expect(hasPositiveCount(null)).toBe(false)
  })
})

describe('morningReminderLines', () => {
  it('nudges stale priorities only on Sunday, and pending proposals any day', () => {
    expect(morningReminderLines({ weekday: 0, prioritiesAgeDays: 20, staleAfterDays: 14, pendingMemoryProposals: 0 })).toEqual([
      '🎯 העדיפויות לא עודכנו 20 ימים — עדיין נכונות?',
    ])
    expect(morningReminderLines({ weekday: 2, prioritiesAgeDays: 20, staleAfterDays: 14, pendingMemoryProposals: 3 })).toEqual([
      '🧠 3 זיכרונות חדשים מחכים לאישור — /memory',
    ])
    expect(morningReminderLines({ weekday: 0, prioritiesAgeDays: null, staleAfterDays: 14, pendingMemoryProposals: 0 })[0]).toContain('עוד לא הגדרת')
  })
})
