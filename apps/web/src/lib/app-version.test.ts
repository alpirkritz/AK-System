import { describe, expect, it } from 'vitest'
import { formatAppVersion } from './app-version'

describe('formatAppVersion', () => {
  it('shows the release number and commit', () => {
    expect(formatAppVersion('12', 'a1b2c3d')).toBe('גרסה 12 · a1b2c3d')
    expect(formatAppVersion('2', '')).toBe('גרסה 2')
  })
  it('calls an unnumbered build a development version', () => {
    expect(formatAppVersion(undefined, 'abc')).toBe('גרסת פיתוח')
    expect(formatAppVersion('', null)).toBe('גרסת פיתוח')
    expect(formatAppVersion('x', 'abc')).toBe('גרסת פיתוח')
  })
})
