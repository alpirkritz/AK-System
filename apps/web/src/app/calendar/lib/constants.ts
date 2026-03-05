import type { RsvpStatus } from './types'

export const HOUR_HEIGHT = 64
export const DAY_START = 7
export const DAY_END = 22
export const VISIBLE_HOURS = DAY_END - DAY_START

export const HE_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
export const HE_DAYS_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
export const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

export const ALL_DAY_MAX_ROWS = 2
export const SYNC_INTERVAL_MS = 15 * 60 * 1000

export const RSVP_LABEL: Record<RsvpStatus, string> = {
  accepted: 'אישרתי',
  declined: 'דחיתי',
  tentative: 'אולי',
  needsAction: 'ממתין לתגובה',
}

export const RSVP_DOT_COLOR: Record<RsvpStatus, string> = {
  accepted: '#4ade80',
  declined: '#f87171',
  tentative: '#fbbf24',
  needsAction: '#94a3b8',
}

export const FALLBACK_COLORS = [
  { bg: 'rgba(59,130,246,0.18)', border: '#60a5fa' },
  { bg: 'rgba(168,85,247,0.18)', border: '#c084fc' },
  { bg: 'rgba(16,185,129,0.18)', border: '#34d399' },
  { bg: 'rgba(245,158,11,0.18)', border: '#fbbf24' },
  { bg: 'rgba(244,63,94,0.18)', border: '#fb7185' },
  { bg: 'rgba(6,182,212,0.18)', border: '#22d3ee' },
]
