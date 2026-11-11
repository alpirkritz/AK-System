/**
 * `meetings.endTime` holds either a wall-clock "HH:MM" (manual meetings) or a full
 * ISO timestamp (Google/Apple calendar sync writes `ev.end` verbatim). Everything
 * that displays or compares an end time should go through this so an ISO value
 * never leaks into the UI as "15:30–2026-11-03T21:00:00+02:00" or breaks a
 * past/upcoming check.
 */
export function clockFromTime(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) return trimmed.padStart(5, '0')
  if (trimmed.includes('T')) {
    const d = new Date(trimmed)
    if (!Number.isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
  }
  // "HH:MM:SS" and friends — keep the first two segments.
  const m = trimmed.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** "10:30–11:00" when an end exists, otherwise just the start. */
export function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = start ?? ''
  const e = clockFromTime(end)
  return e ? `${s}–${e}` : s
}
