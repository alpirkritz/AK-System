import { describe, expect, it } from 'vitest'
import { standingIsStale } from './project-standing'

describe('standingIsStale', () => {
  it('is stale only when a saved brief is older than an analysis', () => {
    expect(standingIsStale(null, '2026-09-25T10:00:00.000Z')).toBe(false)
    expect(standingIsStale('2026-09-25T12:00:00.000Z', '2026-09-25T10:00:00.000Z')).toBe(false)
    expect(standingIsStale('2026-09-25T10:00:00.000Z', '2026-09-25T12:00:00.000Z')).toBe(true)
  })
})
