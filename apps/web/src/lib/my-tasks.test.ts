import { describe, expect, it } from 'vitest'
import { isMyTask } from './my-tasks'

describe('isMyTask', () => {
  it('matches only the owner assignee', () => {
    expect(isMyTask('me', 'me')).toBe(true)
    expect(isMyTask('other', 'me')).toBe(false)
    expect(isMyTask(null, 'me')).toBe(false)
    expect(isMyTask(undefined, 'me')).toBe(false)
  })

  it('stays false until the owner id is known', () => {
    expect(isMyTask('me', null)).toBe(false)
    expect(isMyTask('me', undefined)).toBe(false)
  })
})
