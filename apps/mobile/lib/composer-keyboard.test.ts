import { describe, expect, it } from 'vitest'
import { composerLiftPx } from './composer-keyboard'

describe('composerLiftPx', () => {
  it('is 0 when the keyboard is closed', () => {
    expect(composerLiftPx(0, 0)).toBe(0)
    expect(composerLiftPx(0, 56)).toBe(0)
  })

  it('lifts by the full keyboard height when the window did not shrink (iOS / broken resize)', () => {
    expect(composerLiftPx(300, 0)).toBe(300)
  })

  it('adds no extra lift when adjustResize already consumed the keyboard', () => {
    expect(composerLiftPx(300, 300)).toBe(0)
  })

  it('still lifts when only the tab bar hid (~56–80px) — the previous >80 heuristic padded nothing', () => {
    expect(composerLiftPx(300, 56)).toBe(244)
    expect(composerLiftPx(300, 80)).toBe(220)
  })

  it('does not go negative if the window shrinks more than the keyboard', () => {
    expect(composerLiftPx(300, 400)).toBe(0)
  })
})
