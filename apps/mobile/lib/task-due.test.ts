import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dueDay, isOverdueOpenTask, todayKey } from './task-due.ts'

describe('task due', () => {
  const today = '2026-09-22'

  it('builds a local calendar key', () => {
    assert.equal(todayKey(new Date(2026, 8, 22, 23, 30)), '2026-09-22')
  })

  it('reads a calendar day from a date or datetime', () => {
    assert.equal(dueDay('2026-09-21'), '2026-09-21')
    assert.equal(dueDay('2026-09-21T00:00:00.000Z'), '2026-09-21')
    assert.equal(dueDay('soon'), null)
    assert.equal(dueDay(null), null)
  })

  it('counts only open tasks due before today', () => {
    assert.equal(isOverdueOpenTask({ done: false, dueDate: '2026-09-21' }, today), true)
    assert.equal(isOverdueOpenTask({ done: false, dueDate: '2026-09-22' }, today), false)
    assert.equal(isOverdueOpenTask({ done: false, dueDate: null }, today), false)
    assert.equal(isOverdueOpenTask({ done: true, dueDate: '2026-09-01' }, today), false)
    assert.equal(
      isOverdueOpenTask({ done: false, status: 'cancelled', dueDate: '2026-09-01' }, today),
      false,
    )
  })
})
