import { describe, expect, it } from 'vitest'
import {
  isWhatsappWindow,
  normalizeWhatsappTs,
  resolveWhatsappTimeWindow,
} from './whatsapp-time-window'

const TZ = 'Asia/Jerusalem'

/** 2026-07-09 14:30 Israel summer time (UTC+3). */
const NOW = Date.parse('2026-07-09T11:30:00.000Z')
const TODAY_START = Date.parse('2026-07-08T21:00:00.000Z')
const TOMORROW_START = Date.parse('2026-07-09T21:00:00.000Z')
const YESTERDAY_START = Date.parse('2026-07-07T21:00:00.000Z')

function localClock(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms))
}

describe('resolveWhatsappTimeWindow — rolling windows', () => {
  it('keeps existing rolling behavior anchored to now', () => {
    const r = resolveWhatsappTimeWindow({ window: '24h' }, NOW, TZ)
    expect(r.sinceMs).toBe(NOW - 24 * 3600_000)
    expect(r.untilMs).toBe(NOW)
    expect(r.rangeLabel).toBe('24 השעות האחרונות')
  })

  it('defaults to 24h when nothing is given', () => {
    const r = resolveWhatsappTimeWindow({}, NOW, TZ)
    expect(r.window).toBe('24h')
    expect(r.sinceMs).toBe(NOW - 24 * 3600_000)
  })

  it('supports 6h, 7d and 30d', () => {
    expect(resolveWhatsappTimeWindow({ window: '6h' }, NOW, TZ).sinceMs).toBe(NOW - 6 * 3600_000)
    expect(resolveWhatsappTimeWindow({ window: '7d' }, NOW, TZ).sinceMs).toBe(NOW - 7 * 24 * 3600_000)
    expect(resolveWhatsappTimeWindow({ window: '30d' }, NOW, TZ).sinceMs).toBe(NOW - 30 * 24 * 3600_000)
  })
})

describe('resolveWhatsappTimeWindow — calendar days', () => {
  it('today runs from local midnight to now', () => {
    const r = resolveWhatsappTimeWindow({ window: 'today' }, NOW, TZ)
    expect(r.sinceMs).toBe(TODAY_START)
    expect(r.untilMs).toBe(NOW)
    expect(localClock(r.sinceMs)).toBe('00:00')
    expect(r.rangeLabel).toBe('היום')
  })

  it('yesterday covers only the previous calendar day', () => {
    const r = resolveWhatsappTimeWindow({ window: 'yesterday' }, NOW, TZ)
    expect(r.sinceMs).toBe(YESTERDAY_START)
    expect(r.untilMs).toBe(TODAY_START - 1)
    expect(r.rangeLabel).toBe('אתמול')
  })

  it('excludes messages from today when asking about yesterday', () => {
    const r = resolveWhatsappTimeWindow({ window: 'yesterday' }, NOW, TZ)
    const thisMorning = TODAY_START + 8 * 3600_000
    expect(thisMorning > r.untilMs).toBe(true)
  })

  it('today at 00:30 local does not reach back into yesterday', () => {
    const justAfterMidnight = TOMORROW_START + 30 * 60_000
    const r = resolveWhatsappTimeWindow({ window: 'today' }, justAfterMidnight, TZ)
    expect(r.sinceMs).toBe(TOMORROW_START)
    expect(r.untilMs).toBe(justAfterMidnight)
  })
})

describe('resolveWhatsappTimeWindow — hour ranges', () => {
  it('maps 14–16 to today 14:00 through 15:59:59.999 local', () => {
    const r = resolveWhatsappTimeWindow({ sinceHour: 14, untilHour: 16 }, NOW, TZ)
    expect(r.window).toBe('today')
    expect(r.sinceMs).toBe(TODAY_START + 14 * 3600_000)
    expect(r.untilMs).toBe(TODAY_START + 16 * 3600_000 - 1)
    expect(localClock(r.sinceMs)).toBe('14:00')
    expect(localClock(r.untilMs)).toBe('15:59')
    expect(r.rangeLabel).toBe('היום 14:00–16:00')
  })

  it('anchors hours to yesterday when that window is requested', () => {
    const r = resolveWhatsappTimeWindow({ window: 'yesterday', sinceHour: 22 }, NOW, TZ)
    expect(r.sinceMs).toBe(YESTERDAY_START + 22 * 3600_000)
    expect(r.untilMs).toBe(TODAY_START - 1)
    expect(r.rangeLabel).toBe('אתמול מ-22:00')
  })

  it('treats a lone sinceHour as "from that hour to end of day"', () => {
    const r = resolveWhatsappTimeWindow({ sinceHour: 9 }, NOW, TZ)
    expect(r.sinceMs).toBe(TODAY_START + 9 * 3600_000)
    expect(r.untilMs).toBe(TOMORROW_START - 1)
    expect(r.rangeLabel).toBe('היום מ-09:00')
  })

  it('treats a lone untilHour as "from midnight until that hour"', () => {
    const r = resolveWhatsappTimeWindow({ untilHour: 12 }, NOW, TZ)
    expect(r.sinceMs).toBe(TODAY_START)
    expect(r.untilMs).toBe(TODAY_START + 12 * 3600_000 - 1)
    expect(r.rangeLabel).toBe('היום עד 12:00')
  })

  it('ignores an inverted range by forcing at least one hour', () => {
    const r = resolveWhatsappTimeWindow({ sinceHour: 20, untilHour: 3 }, NOW, TZ)
    expect(r.sinceMs).toBe(TODAY_START + 20 * 3600_000)
    expect(r.untilMs).toBe(TODAY_START + 21 * 3600_000 - 1)
  })

  it('keeps hour ranges inside the calendar day even with a rolling window arg', () => {
    const r = resolveWhatsappTimeWindow({ window: '7d', sinceHour: 8, untilHour: 24 }, NOW, TZ)
    expect(r.sinceMs).toBe(TODAY_START + 8 * 3600_000)
    expect(r.untilMs).toBe(TOMORROW_START - 1)
  })
})

describe('resolveWhatsappTimeWindow — explicit instants', () => {
  it('passes through sinceMs/untilMs', () => {
    const r = resolveWhatsappTimeWindow({ sinceMs: NOW - 5000, untilMs: NOW }, NOW, TZ)
    expect(r.sinceMs).toBe(NOW - 5000)
    expect(r.untilMs).toBe(NOW)
  })

  it('defaults a missing untilMs to now', () => {
    const r = resolveWhatsappTimeWindow({ sinceMs: TODAY_START }, NOW, TZ)
    expect(r.untilMs).toBe(NOW)
  })
})

describe('normalizeWhatsappTs', () => {
  it('converts second-precision timestamps to ms', () => {
    expect(normalizeWhatsappTs(1_770_000_000)).toBe(1_770_000_000_000)
  })

  it('leaves ms timestamps untouched', () => {
    expect(normalizeWhatsappTs(1_770_000_000_000)).toBe(1_770_000_000_000)
  })

  it('falls back for invalid input', () => {
    expect(normalizeWhatsappTs(0, 123)).toBe(123)
    expect(normalizeWhatsappTs(Number.NaN, 123)).toBe(123)
    expect(normalizeWhatsappTs(-5, 123)).toBe(123)
  })
})

describe('isWhatsappWindow', () => {
  it('accepts supported windows and rejects anything else', () => {
    expect(isWhatsappWindow('today')).toBe(true)
    expect(isWhatsappWindow('yesterday')).toBe(true)
    expect(isWhatsappWindow('24h')).toBe(true)
    expect(isWhatsappWindow('2h')).toBe(false)
    expect(isWhatsappWindow(undefined)).toBe(false)
  })
})
