import { describe, expect, it } from 'vitest'
import { keyboardLiftPx } from './composer-keyboard'

describe('keyboardLiftPx', () => {
  it('is 0 when the keyboard is closed', () => {
    expect(keyboardLiftPx(800, 0)).toBe(0)
  })

  it('lifts by the overlap covering the resting view', () => {
    expect(keyboardLiftPx(800, 500)).toBe(300)
  })

  it('is 0 when the resting bottom is already above the keyboard', () => {
    expect(keyboardLiftPx(480, 500)).toBe(0)
  })

  it('uses the same resting bottom when the keyboard moves, so frames do not stack', () => {
    const resting = 800
    expect(keyboardLiftPx(resting, 600)).toBe(200)
    expect(keyboardLiftPx(resting, 500)).toBe(300)
    expect(keyboardLiftPx(resting, 700)).toBe(100)
  })
})
