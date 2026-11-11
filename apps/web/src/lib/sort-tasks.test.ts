import { describe, expect, it } from 'vitest'
import {
  groupTasksByDueState,
  isDashboardTaskSort,
  sortDashboardTasks,
  sortTasksByDueThenPriority,
  sortTasksByPriorityThenDue,
  sortTasksOpenThenDueAsc,
  type DashboardTaskSort,
} from './sort-tasks'

describe('sortTasksOpenThenDueAsc', () => {
  it('puts open tasks before done, then oldest due date first', () => {
    const sorted = sortTasksOpenThenDueAsc([
      { id: '1', done: true, dueDate: '2026-07-01' },
      { id: '2', done: false, dueDate: '2026-08-06' },
      { id: '3', done: false, dueDate: '2026-07-23' },
      { id: '4', done: true, dueDate: '2026-04-28' },
      { id: '5', done: false, dueDate: null },
    ])
    expect(sorted.map((t) => t.id)).toEqual(['3', '2', '5', '4', '1'])
  })
})

describe('groupTasksByDueState', () => {
  const today = '2026-09-26'

  it('keeps the incoming order inside each group and drops empty groups', () => {
    const sorted = sortTasksByPriorityThenDue([
      { id: 'later-low', done: false, priority: 'low', dueDate: '2026-10-02', status: 'not_started' },
      { id: 'late-high', done: false, priority: 'high', dueDate: '2026-09-02', status: 'not_started' },
      { id: 'today-med', done: false, priority: 'medium', dueDate: '2026-09-26', status: 'not_started' },
      { id: 'done', done: true, priority: 'high', dueDate: '2026-09-01', status: 'done' },
    ])
    const groups = groupTasksByDueState(sorted, today)
    expect(groups.map((group) => [group.label, group.tasks.map((task) => task.id)])).toEqual([
      ['באיחור', ['late-high']],
      ['לא באיחור', ['today-med', 'later-low']],
      ['הושלמו', ['done']],
    ])
  })

  it('preserves a caller sort that is not priority-first', () => {
    const groups = groupTasksByDueState([
      { id: 'late-low', done: false, priority: 'low', dueDate: '2026-09-01', status: 'not_started' },
      { id: 'late-high', done: false, priority: 'high', dueDate: '2026-09-20', status: 'not_started' },
    ], today)
    expect(groups[0].tasks.map((task) => task.id)).toEqual(['late-low', 'late-high'])
  })
})

describe('sortTasksByDueThenPriority', () => {
  it('orders by nearest due date first; priority only breaks same-date ties; missing due dates last', () => {
    const tasks = [
      { id: 'low-same-date', dueDate: '2026-08-05', priority: 'low' },
      { id: 'high-same-date', dueDate: '2026-08-05', priority: 'high' },
      { id: 'earlier-low', dueDate: '2026-08-01', priority: 'low' },
      { id: 'no-date-high', dueDate: null, priority: 'high' },
    ]
    expect(sortTasksByDueThenPriority(tasks).map((t) => t.id)).toEqual([
      'earlier-low',
      'high-same-date',
      'low-same-date',
      'no-date-high',
    ])
  })
})

const sample = [
  { id: 'a', dueDate: '2026-08-10', priority: 'low', status: 'in_progress', createdAt: '2026-08-01T10:00:00Z' },
  { id: 'b', dueDate: '2026-08-05', priority: 'high', status: 'not_started', createdAt: '2026-08-03T10:00:00Z' },
  { id: 'c', dueDate: null, priority: 'medium', status: 'blocked', createdAt: '2026-08-02T10:00:00Z' },
  { id: 'd', dueDate: '2026-08-05', priority: 'high', status: 'pending', createdAt: '2026-08-04T10:00:00Z' },
]

describe('sortDashboardTasks', () => {
  it('due_asc: earliest due first, missing last', () => {
    expect(sortDashboardTasks(sample, 'due_asc').map((t) => t.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('due_desc: latest due first, missing last', () => {
    expect(sortDashboardTasks(sample, 'due_desc').map((t) => t.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('priority: high → medium → low, then due asc tie-break', () => {
    expect(sortDashboardTasks(sample, 'priority').map((t) => t.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('created_desc: newest created first', () => {
    expect(sortDashboardTasks(sample, 'created_desc').map((t) => t.id)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('status: lifecycle order, then due asc tie-break', () => {
    expect(sortDashboardTasks(sample, 'status').map((t) => t.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('isDashboardTaskSort validates known keys', () => {
    const valid: DashboardTaskSort = 'priority'
    expect(isDashboardTaskSort(valid)).toBe(true)
    expect(isDashboardTaskSort('nope')).toBe(false)
  })
})
