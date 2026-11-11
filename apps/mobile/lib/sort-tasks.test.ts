import { describe, expect, it } from 'vitest'
import { groupTasksByDueState, sortTasksByPriorityThenDue } from './sort-tasks'

describe('sortTasksByPriorityThenDue', () => {
  it('orders high, then medium, then low, and nearest due date inside a priority', () => {
    const sorted = sortTasksByPriorityThenDue([
      { id: 'low-soon', priority: 'low', dueDate: '2026-09-20' },
      { id: 'high-later', priority: 'high', dueDate: '2026-09-30' },
      { id: 'med-undated', priority: 'medium', dueDate: null },
      { id: 'high-soon', priority: 'high', dueDate: '2026-09-24' },
      { id: 'med-soon', priority: 'medium', dueDate: '2026-09-25' },
      { id: 'unknown', priority: 'urgent', dueDate: '2026-09-01' },
    ])

    expect(sorted.map((t) => t.id)).toEqual([
      'high-soon',
      'high-later',
      'unknown',
      'med-soon',
      'med-undated',
      'low-soon',
    ])
  })

  it('treats a datetime prefix as the due day and keeps the input array intact', () => {
    const input = [
      { id: 'b', priority: 'high' as const, dueDate: '2026-10-02T00:00:00.000Z' },
      { id: 'a', priority: 'high' as const, dueDate: '2026-10-01' },
    ]
    const sorted = sortTasksByPriorityThenDue(input)
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b'])
    expect(input.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('groupTasksByDueState', () => {
  const today = '2026-09-26'

  it('puts overdue open tasks before later open tasks, then done and cancelled', () => {
    const groups = groupTasksByDueState(sortTasksByPriorityThenDue([
      { id: 'later-high', done: false, priority: 'high', dueDate: '2026-10-01', status: 'not_started' },
      { id: 'late-low', done: false, priority: 'low', dueDate: '2026-09-01', status: 'not_started' },
      { id: 'late-high', done: false, priority: 'high', dueDate: '2026-09-20', status: 'in_progress' },
      { id: 'today', done: false, priority: 'medium', dueDate: '2026-09-26', status: 'not_started' },
      { id: 'undated', done: false, priority: 'high', dueDate: null, status: 'not_started' },
      { id: 'done', done: true, priority: 'high', dueDate: '2026-09-01', status: 'done' },
      { id: 'cancelled', done: true, priority: 'low', dueDate: '2026-08-01', status: 'cancelled' },
    ]), today)

    expect(groups.map((group) => [group.label, group.tasks.map((task) => task.id)])).toEqual([
      ['באיחור', ['late-high', 'late-low']],
      ['לא באיחור', ['later-high', 'undated', 'today']],
      ['הושלמו', ['done']],
      ['בוטלו', ['cancelled']],
    ])
  })

  it('omits empty groups and does not treat a missing due day as overdue', () => {
    const groups = groupTasksByDueState([
      { id: 'open', done: false, dueDate: null, status: 'not_started' },
    ], today)
    expect(groups.map((group) => group.key)).toEqual(['upcoming'])
  })
})
