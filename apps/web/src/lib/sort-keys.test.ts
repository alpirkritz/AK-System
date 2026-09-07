import { describe, it, expect } from 'vitest'
import {
  sortTasksByKeys,
  getTaskPrimaryGroup,
  migrateLegacyDashboardSort,
  type TaskSortKey,
  type SortPref,
} from './sort-keys'

describe('sortTasksByKeys', () => {
  const mockTasks = [
    { id: '1', priority: 'high', dueDate: '2026-09-10', status: 'not_started', createdAt: '2026-09-01T10:00:00Z' },
    { id: '2', priority: 'low', dueDate: '2026-09-08', status: 'in_progress', createdAt: '2026-09-02T10:00:00Z' },
    { id: '3', priority: 'medium', dueDate: '2026-09-09', status: 'done', createdAt: '2026-09-03T10:00:00Z' },
    { id: '4', priority: 'high', dueDate: null, status: 'not_started', createdAt: '2026-09-04T10:00:00Z' },
    { id: '5', priority: 'medium', dueDate: '2026-09-07', status: 'blocked', createdAt: '2026-09-05T10:00:00Z' },
  ]

  it('sorts by priority_high then due_asc', () => {
    const pref: SortPref<TaskSortKey> = { primary: 'priority_high', thenBy: 'due_asc' }
    const sorted = sortTasksByKeys(mockTasks, pref)
    
    // High priority first
    expect(sorted[0].id).toBe('1')
    expect(sorted[1].id).toBe('4')
    
    // Then medium
    expect(sorted[2].id).toBe('5')
    expect(sorted[3].id).toBe('3')
    
    // Then low
    expect(sorted[4].id).toBe('2')
  })

  it('sorts by due_asc then priority_high', () => {
    const pref: SortPref<TaskSortKey> = { primary: 'due_asc', thenBy: 'priority_high' }
    const sorted = sortTasksByKeys(mockTasks, pref)
    
    // Earliest due date first (2026-09-07)
    expect(sorted[0].id).toBe('5')
    // Then 2026-09-08
    expect(sorted[1].id).toBe('2')
    // Then 2026-09-09
    expect(sorted[2].id).toBe('3')
    // Then 2026-09-10
    expect(sorted[3].id).toBe('1')
    // Missing due date last
    expect(sorted[4].id).toBe('4')
  })

  it('sorts by due_desc with missing dates last', () => {
    const pref: SortPref<TaskSortKey> = { primary: 'due_desc', thenBy: 'none' }
    const sorted = sortTasksByKeys(mockTasks, pref)
    
    // Latest due date first (2026-09-10)
    expect(sorted[0].id).toBe('1')
    // Then 2026-09-09
    expect(sorted[1].id).toBe('3')
    // Then 2026-09-08
    expect(sorted[2].id).toBe('2')
    // Then 2026-09-07
    expect(sorted[3].id).toBe('5')
    // Missing due date last
    expect(sorted[4].id).toBe('4')
  })

  it('sorts by status_workflow', () => {
    const pref: SortPref<TaskSortKey> = { primary: 'status_workflow', thenBy: 'none' }
    const sorted = sortTasksByKeys(mockTasks, pref)
    
    // not_started (1, 4), in_progress (2), blocked (5), done (3)
    expect(['1', '4']).toContain(sorted[0].id)
    expect(['1', '4']).toContain(sorted[1].id)
    expect(sorted[2].id).toBe('2')
    expect(sorted[3].id).toBe('5')
    expect(sorted[4].id).toBe('3')
  })

  it('sorts by created_desc', () => {
    const pref: SortPref<TaskSortKey> = { primary: 'created_desc', thenBy: 'none' }
    const sorted = sortTasksByKeys(mockTasks, pref)
    
    // Newest first
    expect(sorted[0].id).toBe('5')
    expect(sorted[1].id).toBe('4')
    expect(sorted[2].id).toBe('3')
    expect(sorted[3].id).toBe('2')
    expect(sorted[4].id).toBe('1')
  })

  it('respects then-by none', () => {
    const pref: SortPref<TaskSortKey> = { primary: 'priority_high', thenBy: 'none' }
    const sorted = sortTasksByKeys(mockTasks, pref)
    
    // High priority first (stable id order as tie-break)
    expect(['1', '4']).toContain(sorted[0].id)
    expect(['1', '4']).toContain(sorted[1].id)
  })
})

describe('getTaskPrimaryGroup', () => {
  it('returns priority for priority keys', () => {
    expect(getTaskPrimaryGroup('priority_high')).toBe('priority')
    expect(getTaskPrimaryGroup('priority_low')).toBe('priority')
  })

  it('returns due_date for date keys', () => {
    expect(getTaskPrimaryGroup('due_asc')).toBe('due_date')
    expect(getTaskPrimaryGroup('due_desc')).toBe('due_date')
  })

  it('returns status for status keys', () => {
    expect(getTaskPrimaryGroup('status_workflow')).toBe('status')
    expect(getTaskPrimaryGroup('status_reverse')).toBe('status')
  })

  it('returns created for created keys', () => {
    expect(getTaskPrimaryGroup('created_desc')).toBe('created')
    expect(getTaskPrimaryGroup('created_asc')).toBe('created')
  })

  it('returns none for none', () => {
    expect(getTaskPrimaryGroup('none')).toBe('none')
  })
})

describe('migrateLegacyDashboardSort', () => {
  it('migrates due_asc to priority_high then-by', () => {
    const migrated = migrateLegacyDashboardSort('due_asc')
    expect(migrated).toEqual({ primary: 'due_asc', thenBy: 'priority_high' })
  })

  it('migrates priority to due_asc then-by', () => {
    const migrated = migrateLegacyDashboardSort('priority')
    expect(migrated).toEqual({ primary: 'priority_high', thenBy: 'due_asc' })
  })

  it('migrates created_desc', () => {
    const migrated = migrateLegacyDashboardSort('created_desc')
    expect(migrated).toEqual({ primary: 'created_desc', thenBy: 'due_asc' })
  })

  it('returns null for unknown keys', () => {
    const migrated = migrateLegacyDashboardSort('unknown')
    expect(migrated).toBeNull()
  })
})
