import { describe, expect, it } from 'vitest'
import {
  isKeyboardOpen,
  keyboardOverlapPx,
  mobileAssistantShellStyle,
  scrollChildIntoList,
  scrollElementToBottom,
} from './chat-layout'

describe('keyboardOverlapPx', () => {
  it('returns 0 when the visual viewport fills the window', () => {
    expect(keyboardOverlapPx(800, 800, 0)).toBe(0)
  })

  it('returns the keyboard overlap when the visual viewport shrinks', () => {
    expect(keyboardOverlapPx(800, 500, 0)).toBe(300)
  })

  it('subtracts iOS visualViewport.offsetTop (browser chrome shift)', () => {
    expect(keyboardOverlapPx(800, 500, 40)).toBe(260)
  })
})

describe('isKeyboardOpen', () => {
  it('is false for small chrome jitter', () => {
    expect(isKeyboardOpen(40)).toBe(false)
  })

  it('is true once overlap exceeds the default threshold', () => {
    expect(isKeyboardOpen(120)).toBe(true)
  })
})

describe('mobileAssistantShellStyle', () => {
  it('is undefined on desktop so the keyboard path never runs there', () => {
    expect(mobileAssistantShellStyle(false, 500, 0)).toBeUndefined()
  })

  it('pins the mobile shell to the visual viewport rectangle', () => {
    expect(mobileAssistantShellStyle(true, 420, 0)).toEqual({
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 420,
      width: '100%',
    })
  })

  it('follows iOS visualViewport.offsetTop when Safari pans', () => {
    expect(mobileAssistantShellStyle(true, 420, 80)?.top).toBe(80)
    expect(mobileAssistantShellStyle(true, 420, 80)?.height).toBe(420)
  })
})

describe('scroll helpers', () => {
  it('pins a list to its scrollHeight', () => {
    const el = { scrollHeight: 4000, scrollTop: 0 }
    scrollElementToBottom(el)
    expect(el.scrollTop).toBe(4000)
  })

  it('centers a child inside the list', () => {
    const list = { scrollTop: 0, clientHeight: 400 }
    const child = { offsetTop: 2000, clientHeight: 80 }
    scrollChildIntoList(list, child)
    expect(list.scrollTop).toBe(2000 - 200 + 40)
  })
})
