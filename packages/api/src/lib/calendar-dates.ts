const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem'

/** YYYY-MM-DD for "today" in the given IANA timezone. */
export function localTodayIso(timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

function addCalendarDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
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
