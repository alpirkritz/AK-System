export type RsvpStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction'

export interface CalEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  location?: string | null
  description?: string | null
  status?: string | null
  rsvp?: RsvpStatus
  calendarId?: string | null
  calendarName?: string | null
  calendarColor?: string | null
}

export interface CalendarMeta {
  id: string
  name: string
  color: string
  source: 'google' | 'apple'
}

export interface PositionedEvent {
  ev: CalEvent
  col: number
  totalCols: number
}

export type View = 'day' | 'week' | 'month'
