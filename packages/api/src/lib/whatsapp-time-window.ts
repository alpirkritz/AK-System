import { getDefaultTimezone, localMidnightToUtc } from './calendar-dates'

/** Windows accepted by the WhatsApp insight procedures and by Hugo's tools. */
export const WHATSAPP_WINDOWS = ['6h', '24h', '7d', '30d', 'today', 'yesterday'] as const
export type WhatsappWindow = (typeof WHATSAPP_WINDOWS)[number]

const HOUR_MS = 60 * 60 * 1000

export const ROLLING_WINDOW_MS: Record<string, number> = {
  '6h': 6 * HOUR_MS,
  '24h': 24 * HOUR_MS,
  '7d': 7 * 24 * HOUR_MS,
  '30d': 30 * 24 * HOUR_MS,
}

const ROLLING_LABELS: Record<string, string> = {
  '6h': '6 השעות האחרונות',
  '24h': '24 השעות האחרונות',
  '7d': '7 הימים האחרונים',
  '30d': '30 הימים האחרונים',
}

export interface WhatsappTimeWindowInput {
  window?: WhatsappWindow
  /** Local start hour (0–23) inside the anchored calendar day. */
  sinceHour?: number
  /** Local end hour (1–24), exclusive. */
  untilHour?: number
  sinceMs?: number
  untilMs?: number
}

export interface ResolvedWhatsappTimeWindow {
  window: WhatsappWindow
  sinceMs: number
  /** Inclusive upper bound, so callers can use `ts <= untilMs`. */
  untilMs: number
  rangeLabel: string
}

export function isWhatsappWindow(value: unknown): value is WhatsappWindow {
  return typeof value === 'string' && (WHATSAPP_WINDOWS as readonly string[]).includes(value)
}

/** WhatsApp timestamps arrive in seconds or ms; store ms everywhere. */
export function normalizeWhatsappTs(raw: number, fallbackMs: number = Date.now()): number {
  if (!Number.isFinite(raw) || raw <= 0) return fallbackMs
  return Math.round(raw < 1e12 ? raw * 1000 : raw)
}

function localDateIso(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(instant))
}

function shiftDateIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function localClockLabel(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant))
}

function localDayLabel(dateIso: string, todayIso: string, yesterdayIso: string): string {
  if (dateIso === todayIso) return 'היום'
  if (dateIso === yesterdayIso) return 'אתמול'
  const [, m, d] = dateIso.split('-')
  return `${Number(d)}/${Number(m)}`
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function isHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Turn a named window and/or local hour range into an absolute `[sinceMs, untilMs]`
 * range in the system timezone. Calendar days ("today"/"yesterday") are resolved
 * against local midnight rather than a rolling offset from now, which is what makes
 * "what happened today" and "between 14 and 16" answerable.
 *
 * Hour offsets are added to local midnight; on the two DST transition days per year
 * the boundary can be off by an hour, but stays clamped inside the calendar day.
 */
export function resolveWhatsappTimeWindow(
  input: WhatsappTimeWindowInput = {},
  nowMs: number = Date.now(),
  timeZone: string = getDefaultTimezone(),
): ResolvedWhatsappTimeWindow {
  const hasHours = isHour(input.sinceHour) || isHour(input.untilHour)
  const window: WhatsappWindow = input.window ?? (hasHours ? 'today' : '24h')

  if (input.sinceMs !== undefined || input.untilMs !== undefined) {
    const sinceMs = input.sinceMs ?? 0
    const untilMs = input.untilMs ?? nowMs
    return {
      window,
      sinceMs,
      untilMs,
      rangeLabel: `${localClockLabel(sinceMs, timeZone)}–${localClockLabel(untilMs, timeZone)}`,
    }
  }

  const todayIso = localDateIso(nowMs, timeZone)
  const yesterdayIso = shiftDateIso(todayIso, -1)

  if (hasHours || window === 'today' || window === 'yesterday') {
    const dayIso = window === 'yesterday' ? yesterdayIso : todayIso
    const dayStart = localMidnightToUtc(dayIso, timeZone).getTime()
    const dayEnd = localMidnightToUtc(shiftDateIso(dayIso, 1), timeZone).getTime()
    const dayLabel = localDayLabel(dayIso, todayIso, yesterdayIso)

    if (!hasHours) {
      const untilMs = dayIso === todayIso ? Math.min(nowMs, dayEnd - 1) : dayEnd - 1
      return { window, sinceMs: dayStart, untilMs, rangeLabel: dayLabel }
    }

    const sinceHour = isHour(input.sinceHour) ? clamp(Math.floor(input.sinceHour), 0, 23) : 0
    const rawUntilHour = isHour(input.untilHour) ? clamp(Math.ceil(input.untilHour), 1, 24) : 24
    const untilHour = Math.max(rawUntilHour, sinceHour + 1)

    const sinceMs = clamp(dayStart + sinceHour * HOUR_MS, dayStart, dayEnd - 1)
    const untilMs = clamp(dayStart + untilHour * HOUR_MS - 1, sinceMs, dayEnd - 1)

    const rangeLabel = isHour(input.sinceHour)
      ? isHour(input.untilHour)
        ? `${dayLabel} ${hourLabel(sinceHour)}–${hourLabel(untilHour)}`
        : `${dayLabel} מ-${hourLabel(sinceHour)}`
      : `${dayLabel} עד ${hourLabel(untilHour)}`

    return { window, sinceMs, untilMs, rangeLabel }
  }

  const span = ROLLING_WINDOW_MS[window] ?? ROLLING_WINDOW_MS['24h']
  return {
    window,
    sinceMs: nowMs - span,
    untilMs: nowMs,
    rangeLabel: ROLLING_LABELS[window] ?? ROLLING_LABELS['24h'],
  }
}
