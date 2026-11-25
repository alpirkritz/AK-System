const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem'

/** YYYY-MM-DD for "today" in the given IANA timezone. */
export function localTodayIso(timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

function addCalendarDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** YYYY-MM-DD for "tomorrow" in the given IANA timezone. */
export function localTomorrowIso(timeZone = DEFAULT_TIMEZONE): string {
  return addCalendarDay(localTodayIso(timeZone))
}

/** Resolve tool date arg: today | tomorrow | yesterday | מחר | היום | אתמול | YYYY-MM-DD → local ISO date. */
export function resolveLocalDayArg(raw: string, timeZone = DEFAULT_TIMEZONE): string {
  const v = raw.trim().toLowerCase()
  if (v === 'tomorrow' || v === 'מחר') return localTomorrowIso(timeZone)
  if (v === 'yesterday' || v === 'אתמול') {
    const [year, month, day] = localTodayIso(timeZone).split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
  }
  if (v === 'today' || v === 'היום' || v === '') return localTodayIso(timeZone)
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return localTodayIso(timeZone)
}

function localDateIsoInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant)
}

/** UTC instant of local 00:00 on `dateIso` in `timeZone`. */
export function localMidnightToUtc(dateIso: string, timeZone = DEFAULT_TIMEZONE): Date {
  const [year, month, day] = dateIso.split('-').map(Number)
  let probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))

  for (let h = -16; h <= 16; h++) {
    const candidate = new Date(probe.getTime() + h * 3_600_000)
    if (localDateIsoInZone(candidate, timeZone) !== dateIso) continue

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(candidate)

    // Small-ICU Node builds format local midnight as hour "24" instead of "0";
    // `% 24` normalizes that so we don't subtract a full extra day (which shifted
    // every server-side calendar fetch back by one day). See calendar-dates.test.
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    const second = Number(parts.find((p) => p.type === 'second')?.value ?? 0)
    return new Date(candidate.getTime() - ((hour * 60 + minute) * 60 + second) * 1000)
  }

  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
}

/**
 * Inclusive local date range [startDate, endDate] → UTC instants for Google API.
 * `timeMax` is exclusive (midnight after endDate in local TZ).
 */
export function localDateRangeToUtc(
  startDate: string,
  endDate: string,
  timeZone = DEFAULT_TIMEZONE,
): { timeMin: Date; timeMax: Date } {
  return {
    timeMin: localMidnightToUtc(startDate, timeZone),
    timeMax: localMidnightToUtc(addCalendarDay(endDate), timeZone),
  }
}

export function getDefaultTimezone(): string {
  return DEFAULT_TIMEZONE
}

/** True when the string carries a UTC `Z` or a numeric offset. Floating `YYYY-MM-DDTHH:mm:ss` does not. */
function hasExplicitOffset(iso: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(iso.trim())
}

function clockFromInstant(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  let hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  if (hour === '24') hour = '00'
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

/**
 * Clock in `timeZone`.
 * Floating timestamps (no Z/offset) keep their digits — those strings are already wall time.
 * `Z` and numeric offsets are converted, so `12:30:00Z` in summer Israel is `15:30`.
 */
export function formatLocalClock(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  if (!iso.includes('T')) return 'כל היום'
  const rawClock = iso.slice(11, 16)
  if (!hasExplicitOffset(iso)) return rawClock
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return rawClock
  return clockFromInstant(instant, timeZone)
}

/** `15:30–16:00`, or a single clock when end is missing or equal. All-day stays `כל היום`. */
export function formatLocalRange(
  start: string,
  end?: string | null,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const startClock = formatLocalClock(start, timeZone)
  if (startClock === 'כל היום' || !end) return startClock
  const endClock = formatLocalClock(end, timeZone)
  if (endClock === 'כל היום' || endClock === startClock) return startClock
  return `${startClock}–${endClock}`
}

/**
 * Same instant, written as RFC3339 in `timeZone` (`2026-09-23T15:30:00+03:00`).
 * Floating timestamps are returned unchanged.
 */
export function toZonedIso(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  if (!iso.includes('T') || !hasExplicitOffset(iso)) return iso
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'
  let hour = get('hour')
  if (hour === '24') hour = '00'
  const wall = `${get('year')}-${get('month')}-${get('day').padStart(2, '0')}T${hour.padStart(2, '0')}:${get('minute').padStart(2, '0')}:${get('second').padStart(2, '0')}`
  const offsetMin = Math.round((Date.parse(`${wall}Z`) - instant.getTime()) / 60_000)
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const oh = String(Math.floor(abs / 60)).padStart(2, '0')
  const om = String(abs % 60).padStart(2, '0')
  return `${wall}${sign}${oh}:${om}`
}
