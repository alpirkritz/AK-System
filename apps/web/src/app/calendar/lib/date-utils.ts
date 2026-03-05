import { DAY_START, HOUR_HEIGHT, HE_DAYS_LONG, HE_MONTHS } from './constants'

export function startOfWeek(d: Date): Date {
  const day = new Date(d)
  day.setDate(day.getDate() - day.getDay())
  day.setHours(0, 0, 0, 0)
  return day
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isToday(d: Date): boolean {
  return isoDate(d) === isoDate(new Date())
}

export function minutesFromMidnight(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

export function eventTop(startIso: string): number {
  return Math.max(0, ((minutesFromMidnight(startIso) - DAY_START * 60) / 60) * HOUR_HEIGHT)
}

export function eventHeight(startIso: string, endIso: string): number {
  const dur = Math.max(30, minutesFromMidnight(endIso) - minutesFromMidnight(startIso))
  return (dur / 60) * HOUR_HEIGHT
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function fmtFullDate(iso: string): string {
  const d = new Date(iso)
  return `${HE_DAYS_LONG[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}
