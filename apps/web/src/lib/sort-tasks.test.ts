import { describe, expect, it } from 'vitest'
import {
  isDashboardTaskSort,
  sortDashboardTasks,
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
