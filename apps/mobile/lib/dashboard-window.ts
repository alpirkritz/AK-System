import { todayKey } from './task-due'

export type MeetingWindow = 'today' | '3days' | 'week'

export function endDateForWindow(window: MeetingWindow, now = new Date()): string {
  if (window === 'today') return todayKey(now)
  const d = new Date(now)
  d.setDate(d.getDate() + (window === '3days' ? 2 : 6))
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function meetingWindowPhrase(window: MeetingWindow): string {
  if (window === 'today') return 'היום'
  if (window === '3days') return '3 הימים הקרובים'
  return 'השבוע'
}

export function emptyMeetingsCopy(window: MeetingWindow): string {
  if (window === 'today') return 'אין פגישות היום'
  if (window === '3days') return 'אין פגישות ב-3 הימים הקרובים'
  return 'אין פגישות השבוע'
}

export function parseMeetingWindow(value: string | string[] | undefined): MeetingWindow | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === 'today' || raw === '3days' || raw === 'week') return raw
  return null
}
