import { describe, expect, it } from 'vitest'
import { dueDay, formatDueLabel, isOverdueOpenTask, todayKey } from './task-due'

describe('task due', () => {
  const today = '2026-09-22'

  it('builds a local calendar key', () => {
    expect(todayKey(new Date(2026, 8, 22, 23, 30))).toBe('2026-09-22')
  })

  it('reads a calendar day from a date or datetime', () => {
    expect(dueDay('2026-09-21')).toBe('2026-09-21')
    expect(dueDay('2026-09-21T00:00:00.000Z')).toBe('2026-09-21')
    expect(dueDay(null)).toBeNull()
  })

  it('labels only open tasks due before today as overdue', () => {
    expect(isOverdueOpenTask({ done: false, dueDate: '2026-09-21' }, today)).toBe(true)
    expect(isOverdueOpenTask({ done: false, dueDate: '2026-09-22' }, today)).toBe(false)
    expect(isOverdueOpenTask({ done: true, dueDate: '2026-09-01' }, today)).toBe(false)
    expect(formatDueLabel({ done: false, dueDate: '2026-09-21' }, today)).toMatch(/^באיחור · /)
    expect(formatDueLabel({ done: false, dueDate: '2026-09-22' }, today)).not.toMatch(/באיחור/)
  })
})
