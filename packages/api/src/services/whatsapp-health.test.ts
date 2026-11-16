import { describe, expect, it } from 'vitest'
import { dayStartMs, decideHealthAction, evaluateWhatsappHealth, REMIND_HOURS, type HealthInput } from './whatsapp-health'

const TZ = 'Asia/Jerusalem'
// 2026-11-14 20:30 Israel (UTC+2) = 18:30Z
const NOW = new Date('2026-11-14T18:30:00Z')
const H = 3_600_000
const ok = { connected: true, lastError: null }

function input(over: Partial<HealthInput>): HealthInput {
  return { status: ok, statusError: null, lastMessageTs: NOW.getTime() - H, now: NOW, timeZone: TZ, ...over }
}

describe('evaluateWhatsappHealth', () => {
  it('computes 07:00 local as the day start', () => {
    expect(new Date(dayStartMs(NOW, TZ)).toISOString()).toBe('2026-11-14T05:00:00.000Z')
  })

  it('is healthy when messages are arriving', () => {
    expect(evaluateWhatsappHealth(input({})).healthy).toBe(true)
  })

  it('flags "connected" but silent — the Bad MAC case', () => {
    const v = evaluateWhatsappHealth(input({ lastMessageTs: Date.parse('2026-11-12T12:18:00Z') }))
    expect(v.healthy).toBe(false)
    expect(v.problem).toBe('stale')
    expect(v.detail).toContain('2 ימים')
  })

  it('does not count night silence', () => {
    // 09:30 local, last message 23:00 the night before → only 2.5h since 07:00
    const morning = new Date('2026-11-14T07:30:00Z')
    const v = evaluateWhatsappHealth(input({ now: morning, lastMessageTs: Date.parse('2026-11-13T21:00:00Z') }))
    expect(v.healthy).toBe(true)
    // …but by 12:00 local with nothing since, it is a stall
    const noon = new Date('2026-11-14T10:00:00Z')
    expect(evaluateWhatsappHealth(input({ now: noon, lastMessageTs: Date.parse('2026-11-13T21:00:00Z') })).problem).toBe('stale')
  })

  it('flags disconnected and unreachable bridges immediately', () => {
    expect(evaluateWhatsappHealth(input({ status: { connected: false, lastError: 'Logged out' } })).problem).toBe('disconnected')
    expect(evaluateWhatsappHealth(input({ status: null, statusError: 'ECONNREFUSED' })).problem).toBe('unreachable')
  })
})

describe('decideHealthAction', () => {
  const bad = evaluateWhatsappHealth(input({ status: null }))
  const good = evaluateWhatsappHealth(input({}))

  it('alerts once, reminds after REMIND_HOURS, and announces recovery', () => {
    expect(decideHealthAction(bad, null, NOW)).toBe('alert')
    expect(decideHealthAction(bad, new Date(NOW.getTime() - H).toISOString(), NOW)).toBe('none')
    expect(decideHealthAction(bad, new Date(NOW.getTime() - REMIND_HOURS * H).toISOString(), NOW)).toBe('remind')
    expect(decideHealthAction(good, new Date(NOW.getTime() - H).toISOString(), NOW)).toBe('recovered')
    expect(decideHealthAction(good, null, NOW)).toBe('none')
  })
})
